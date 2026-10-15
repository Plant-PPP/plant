import {
  admitLiabilityEvent,
  admitLiabilityEventDeletion,
  admitLiabilityUpdate,
  cashAfter,
  type Liability,
  type LiabilityEvent,
  liabilityEventInputSchema,
  liabilityEventSchema,
  liabilityInputSchema,
} from "@plant/core";
import {
  compareDecimals,
  exactOf,
  minus,
  negated,
  plus,
  stored,
} from "@plant/shared";
import { z } from "zod";

import type { DebtEventCode, DebtEventResult } from "@/lib/debts/events-write";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

const addDecimals = (a: string, b: string): string =>
  stored(plus(exactOf(a), exactOf(b)));

import {
  type PrototypeState,
  refusedWrite,
  type Write,
} from "./prototype-store";

export function createLiability(
  state: PrototypeState,
  input: unknown,
  id: string,
): Write<WriteResult> {
  const parsed = liabilityInputSchema.safeParse(input);
  if (!parsed.success) return refusedWrite(state, "invalid");
  return {
    state: {
      ...state,
      liabilities: [
        {
          id,
          ...parsed.data,
          anchored_on: parsed.data.opened_on ?? state.today,
        },
        ...state.liabilities,
      ],
    },
    result: { ok: true, id },
  };
}

export function updateLiability(
  state: PrototypeState,
  id: string,
  input: unknown,
): Write<WriteResult> {
  const parsed = liabilityInputSchema.safeParse(input);
  if (!parsed.success) return refusedWrite(state, "invalid");
  const current = state.liabilities.find((each) => each.id === id);
  if (!current) return refusedWrite(state, "not_found");
  const anchorWhenCleared =
    current.opened_on === null ? current.anchored_on : state.today;
  // private.liability_guard's refusals, which the real writer reads as
  // invalid.
  if (
    admitLiabilityUpdate(
      current,
      parsed.data,
      state.liabilityEvents.get(id) ?? [],
      anchorWhenCleared,
      state.today,
    )
  ) {
    return refusedWrite(state, "invalid");
  }
  return {
    state: {
      ...state,
      liabilities: state.liabilities.map((each) =>
        each.id === id
          ? {
              id,
              ...parsed.data,
              // Without an opening day the anchor is the day it was created,
              // as private.liability_guard keeps it; the prototype keeps no
              // creation day, so clearing one anchors on today.
              anchored_on: parsed.data.opened_on ?? anchorWhenCleared,
            }
          : each,
      ),
    },
    result: { ok: true, id },
  };
}

export function deleteLiability(
  state: PrototypeState,
  id: string,
): Write<WriteResult> {
  if (!state.liabilities.some((each) => each.id === id)) {
    return refusedWrite(state, "not_found");
  }
  return {
    state: {
      ...state,
      liabilities: state.liabilities.filter((each) => each.id !== id),
    },
    result: { ok: true, id },
  };
}

type EventWrite = Write<DebtEventResult>;

const refusedEvent = (
  state: PrototypeState,
  code: DebtEventCode,
): EventWrite => ({ state, result: { ok: false, code } });

const cashLinkSchema = z
  .object({
    holding_id: z.string().min(1),
    take: z.boolean(),
    expected: z.string().nullable(),
  })
  .strict()
  .nullable();

// Gives back what a payment took from its cash holding, opening it again when
// the payment had emptied it; public.restore_cash also tries the account's
// other cash, which the prototype keeps none of.
function restoreCash(
  state: PrototypeState,
  event: LiabilityEvent,
): { state: PrototypeState; restored: boolean } {
  if (!event.takes_cash) return { state, restored: true };
  const held = state.holdings.find(
    (each) => each.holding.id === event.cash_holding_id,
  );
  if (!held || held.holding.asset_class !== "cash" || !event.amount) {
    return { state, restored: false };
  }
  // A closed holding keeps the amount it had before it was emptied.
  const amount = held.closed
    ? event.amount
    : addDecimals(held.holding.amount, event.amount);
  return {
    state: {
      ...state,
      holdings: state.holdings.map((each) =>
        each === held
          ? { ...each, closed: false, holding: { ...each.holding, amount } }
          : each,
      ),
    },
    restored: true,
  };
}

// Takes `amount` from a payment's cash holding (gives it back when negative),
// as public.move_cash does: nothing to move skips the stale check.
function takeCash(
  state: PrototypeState,
  debt: Liability,
  holdingId: string,
  expected: string | null,
  amount: string | null,
): Write<DebtEventCode | null> {
  const held = state.holdings.find(
    (each) => each.holding.id === holdingId && !each.closed,
  );
  if (!held || held.holding.asset_class !== "cash") {
    return { state, result: "not_found" };
  }
  if (held.holding.currency !== debt.currency) {
    return { state, result: "currency" };
  }
  if (amount === null || compareDecimals(amount, "0") === 0) {
    return { state, result: null };
  }
  if (
    expected === null ||
    compareDecimals(expected, held.holding.amount) !== 0
  ) {
    return { state, result: "stale" };
  }
  const after = cashAfter(
    held.holding.amount,
    stored(negated(exactOf(amount))),
  );
  if (after === "insufficient_cash") return { state, result: after };
  return {
    state: {
      ...state,
      holdings: state.holdings.map((each) =>
        each === held
          ? {
              ...each,
              closed: after.archived,
              holding: { ...each.holding, amount: after.amount },
            }
          : each,
      ),
    },
    result: null,
  };
}

// Records or edits a debt's event over the prototype's store, by the rules the
// event RPCs keep: the event's own, a debt's (admitLiabilityEvent), and the
// cash it moves.
export function writeLiabilityEvent(
  state: PrototypeState,
  call: { debtId: string; id: string; createdAt: string } | { eventId: string },
  event: unknown,
  cash: unknown,
): EventWrite {
  const editing = "eventId" in call;
  const previous = editing
    ? [...state.liabilityEvents.values()]
        .flat()
        .find((each) => each.id === call.eventId)
    : undefined;
  const debtId = editing ? previous?.liability_id : call.debtId;
  const debt = state.liabilities.find((each) => each.id === debtId);
  if (!debt || (editing && !previous)) return refusedEvent(state, "not_found");
  const input = liabilityEventInputSchema.safeParse(event);
  const link = cashLinkSchema.safeParse(cash ?? null);
  if (
    !input.success ||
    !link.success ||
    (previous && previous.kind !== input.data.kind) ||
    (link.data !== null && input.data.kind !== "payment")
  ) {
    return refusedEvent(state, "invalid");
  }
  const events = state.liabilityEvents.get(debt.id) ?? [];
  const amount = "amount" in input.data ? input.data.amount : null;
  const hint = admitLiabilityEvent(
    debt,
    events,
    {
      id: previous?.id,
      kind: input.data.kind,
      date: input.data.date,
      amount,
      settles: "settles" in input.data && input.data.settles,
      cash_holding_id: link.data?.holding_id ?? null,
    },
    state.today,
  );
  if (hint) return refusedEvent(state, hint);
  // An edit that keeps taking from the same open holding moves it by the
  // difference, as update_liability_event does.
  const sameHolding =
    previous?.takes_cash === true &&
    link.data?.take === true &&
    previous.cash_holding_id === link.data.holding_id &&
    state.holdings.some(
      (each) => each.holding.id === link.data!.holding_id && !each.closed,
    );
  const restored =
    previous && !sameHolding
      ? restoreCash(state, previous)
      : { state, restored: true };
  const taken = link.data
    ? takeCash(
        restored.state,
        debt,
        link.data.holding_id,
        link.data.expected,
        link.data.take
          ? sameHolding
            ? stored(minus(exactOf(amount!), exactOf(previous!.amount!)))
            : amount
          : null,
      )
    : { state: restored.state, result: null };
  if (taken.result) return refusedEvent(state, taken.result);
  const row = liabilityEventSchema.parse({
    id: previous?.id ?? (call as { id: string }).id,
    liability_id: debt.id,
    created_at:
      previous?.created_at ?? (call as { createdAt: string }).createdAt,
    kind: input.data.kind,
    date: input.data.date,
    amount,
    annual_rate: "annual_rate" in input.data ? input.data.annual_rate : null,
    cash_holding_id: link.data?.holding_id ?? null,
    takes_cash: link.data?.take ?? false,
    settles: "settles" in input.data && input.data.settles,
  });
  const liabilityEvents = new Map(taken.state.liabilityEvents);
  liabilityEvents.set(debt.id, [
    row,
    ...events.filter((each) => each.id !== row.id),
  ]);
  return {
    state: { ...taken.state, liabilityEvents },
    result: { ok: true, id: row.id, cashRestored: restored.restored },
  };
}

export function deleteLiabilityEvent(
  state: PrototypeState,
  eventId: string,
): EventWrite {
  const event = [...state.liabilityEvents.values()]
    .flat()
    .find((each) => each.id === eventId);
  if (!event) return refusedEvent(state, "not_found");
  const all = state.liabilityEvents.get(event.liability_id) ?? [];
  if (admitLiabilityEventDeletion(all, eventId)) {
    return refusedEvent(state, "settled");
  }
  const restored = restoreCash(state, event);
  const liabilityEvents = new Map(restored.state.liabilityEvents);
  liabilityEvents.set(
    event.liability_id,
    all.filter((each) => each.id !== eventId),
  );
  return {
    state: { ...restored.state, liabilityEvents },
    result: { ok: true, id: eventId, cashRestored: restored.restored },
  };
}

export function setCollateral(
  state: PrototypeState,
  debtId: string,
  holdingIds: unknown,
): Write<WriteResult> {
  const ids = z.array(z.string()).safeParse(holdingIds);
  if (!ids.success) return refusedWrite(state, "invalid");
  if (
    !state.liabilities.some((each) => each.id === debtId) ||
    ids.data.some(
      (id) => !state.holdings.some((each) => each.holding.id === id),
    )
  ) {
    return refusedWrite(state, "not_found");
  }
  const liabilityCollateral = new Map(state.liabilityCollateral);
  liabilityCollateral.set(debtId, [...new Set(ids.data)]);
  return {
    state: { ...state, liabilityCollateral },
    result: { ok: true, id: debtId },
  };
}
