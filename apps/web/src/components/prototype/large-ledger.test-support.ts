import {
  type Charge,
  type ManualPrice,
  type Movement,
  type MovementRates,
  type StoredQuotes,
  UNIT_FX_KINDS,
} from "@plant/core";
import { addDays } from "@plant/shared";

import { rowOf } from "@/components/holdings/holding-fields";
import type { InstrumentRow } from "@/lib/holdings/read";
import { buildFixtures } from "@/lib/prototype/fixtures";
import { MANUAL } from "@/lib/ledger/ledger";
import type { ClosesState } from "@/lib/summary/compute";

import { initialState } from "./prototype-store";

// A ledger near the movement limit: the prototype's accounts, debts and other
// holdings, with `count` made-up movements over ten years across three
// accounts and forty instruments, each in two portfolios. Every kind shows
// up, opening balances and adjustments out included, and the same seed gives
// the same ledger.
export function largeLedger(
  today: string,
  { count, seed }: { count: number; seed: number },
): ClosesState {
  const base = initialState(buildFixtures(today), today);
  const days = 3650;
  const start = addDays(today, -days);
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (n: number) => Math.floor(random() * n);
  const decimal = (cents: number) =>
    `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

  const mep = (day: number) => 10_000 + day * 30 + (day % 7) * 20;
  const fx: Record<string, (day: number) => number> = {
    mep,
    ccl: (day) => mep(day) + 500 + day,
    official: (day) => Math.round(mep(day) * 0.8),
    uva: (day) => 5_000 + day * 15,
  };
  const ratesOn = (day: number): MovementRates =>
    Object.fromEntries(
      UNIT_FX_KINDS.map((kind) => [
        kind,
        { sell: decimal(fx[kind]!(day)), date: addDays(start, day) },
      ]),
    ) as MovementRates;

  const instruments: InstrumentRow[] = Array.from({ length: 40 }, (_, i) => ({
    symbol: `I${String(i).padStart(2, "0")}`,
    name: `Instrument ${i}`,
    currency: i % 2 === 0 ? "ARS" : "USD",
    type: i % 2 === 0 ? "cedear" : "bond",
  }));
  const priceCents = (i: number, day: number) =>
    Math.max(
      1,
      Math.round((1_000 + i * 137) * (1 + day / 1_000)) +
        ((day * (i + 3)) % 200),
    );
  // A third of them have no feed: their last trade prices them, or a manual
  // price for some.
  const fed = (i: number) => i % 3 !== 0;

  const fxRates: StoredQuotes["fxRates"] = [];
  const prices: StoredQuotes["prices"] = [];
  for (let day = -31; day <= days; day += 1) {
    const date = addDays(start, day);
    for (const kind of Object.keys(fx)) {
      fxRates.push({
        kind: kind as "mep",
        rate_date: date,
        sell: decimal(fx[kind]!(Math.max(0, day))),
      });
    }
    instruments.forEach((instrument, i) => {
      if (!fed(i)) return;
      prices.push({
        symbol: instrument.symbol,
        price_date: date,
        price: decimal(priceCents(i, Math.max(0, day))),
        currency: instrument.currency,
      });
    });
  }
  const manualPrices: ManualPrice[] = instruments.flatMap((instrument, i) =>
    i % 9 === 0
      ? [400, 1_200, 2_900].map((day) => ({
          symbol: instrument.symbol,
          price_date: addDays(start, day),
          price: decimal(priceCents(i, day)),
          currency: instrument.currency,
        }))
      : [],
  );

  const accounts = base.accounts.slice(0, 3);
  type Slot = {
    id: string;
    instrument: number;
    account: (typeof accounts)[number];
    portfolio: (typeof base.portfolios)[number];
    units: number;
    started: boolean;
    sibling: number;
    movements: Movement[];
  };
  const slots: Slot[] = instruments.flatMap((_, i) => {
    const account = accounts[i % 3]!;
    const other = base.portfolios.find(
      (each) => each.id !== account.portfolio.id,
    )!;
    return [account.portfolio, other].map((portfolio, p) => ({
      id: `c3000000-0000-4000-8000-${String(i * 2 + p + 1).padStart(12, "0")}`,
      instrument: i,
      account,
      portfolio,
      units: 0,
      started: false,
      sibling: i * 2 + (1 - p),
      movements: [],
    }));
  });

  let made = 0;
  for (let n = 0; made < count; n += 1) {
    const day = Math.min(days, Math.floor((n * days) / count));
    const date = addDays(start, day);
    const slot = slots[pick(slots.length)]!;
    const i = slot.instrument;
    const instrument = instruments[i]!;
    const common = {
      holding_id: slot.id,
      operation_id: `op-${n}`,
      entry_order: n,
      date,
      currency: instrument.currency,
      reference: null,
      note: null,
      rates: ratesOn(day),
    };
    const id = (side = "") => `mv-${n}${side}`;
    let price = priceCents(i, day);
    // Some trades of a peso instrument settle in dollars.
    if (instrument.currency === "ARS" && random() < 0.05) {
      common.currency = "USD";
      price = Math.max(1, Math.round((price * 100) / mep(day)));
    }
    const charged = (units: number): Charge[] => [
      {
        kind: "commission",
        label: null,
        amount: decimal(Math.max(1, Math.round((price * units) / 20_000))),
      },
    ];
    const add = (movement: Movement, to: Slot = slot) => {
      to.movements.push(movement);
      to.started = true;
      made += 1;
    };
    const taken = () =>
      Math.min(
        slot.units,
        Math.max(1, Math.floor(slot.units * (0.05 + random() * 0.55))),
      );

    if (!slot.started) {
      const units = 100 + pick(4_900);
      slot.units += units;
      add({
        ...common,
        id: id(),
        kind: random() < 0.5 ? "opening_balance" : "purchase",
        quantity: decimal(units),
        price: decimal(price),
        charges: [],
      });
      continue;
    }
    const roll = random();
    const out = slot.units > 0;
    if (roll < 0.2 && out) {
      const units = taken();
      slot.units -= units;
      add({
        ...common,
        id: id(),
        kind: "sale",
        quantity: decimal(units),
        price: decimal(price),
        charges: charged(units),
      });
    } else if (roll < 0.28) {
      add({
        ...common,
        id: id(),
        kind: random() < 0.75 ? "dividend" : "coupon",
        currency: "USD",
        amount: decimal(100 + pick(5_000)),
        charges: [{ kind: "tax", label: null, amount: "0.50" }],
      });
    } else if (roll < 0.33 && out) {
      const units = taken();
      slot.units -= units;
      add({
        ...common,
        id: id(),
        kind: "adjustment",
        direction: "out",
        quantity: decimal(units),
        price: "0",
        charges: [],
      });
    } else if (roll < 0.36) {
      const units = 1 + pick(500);
      slot.units += units;
      add({
        ...common,
        id: id(),
        kind: "adjustment",
        direction: "in",
        quantity: decimal(units),
        price: random() < 0.5 ? "0" : decimal(price),
        charges: [],
      });
    } else if (roll < 0.43 && out) {
      const units = taken();
      const to = slots[slot.sibling]!;
      slot.units -= units;
      to.units += units;
      const moved = { ...common, kind: "transfer" as const, charges: [] as [] };
      add({
        ...moved,
        id: id("o"),
        direction: "out",
        quantity: decimal(units),
        price: null,
      });
      add(
        {
          ...moved,
          id: id("i"),
          holding_id: to.id,
          direction: "in",
          quantity: decimal(units),
          price: null,
        },
        to,
      );
    } else if (roll < 0.5) {
      const away = random() < 0.4 && out;
      const units = away ? taken() : 1 + pick(300);
      slot.units += away ? -units : units;
      add({
        ...common,
        id: id(),
        kind: "yield",
        direction: away ? "out" : "in",
        quantity: decimal(units),
        price: decimal(price),
        charges: [],
      });
    } else {
      const units = 100 + pick(4_900);
      slot.units += units;
      add({
        ...common,
        id: id(),
        kind: "purchase",
        quantity: decimal(units),
        price: decimal(price),
        charges: charged(units),
      });
    }
  }

  const movements = new Map<string, readonly Movement[]>(
    slots.flatMap((slot) =>
      slot.movements.length ? [[slot.id, slot.movements] as const] : [],
    ),
  );
  const holdings = [
    ...slots.map((slot) => {
      const row = rowOf(
        slot.id,
        {
          asset_class: "instrument",
          instrument_symbol: instruments[slot.instrument]!.symbol,
          currency: null,
          annual_rate: null,
          started_on: null,
          matures_on: null,
          valued_on: null,
          label: null,
          amount: slot.units > 0 ? decimal(slot.units) : "1",
        },
        {
          account: {
            id: slot.account.id,
            institution: slot.account.institution,
          },
          portfolio: slot.portfolio,
          instrumentType: instruments[slot.instrument]!.type,
        },
      );
      return {
        holding: row.holding,
        accountId: slot.account.id,
        portfolioId: slot.portfolio.id,
        closed: slot.units === 0,
        origin: MANUAL,
      };
    }),
    ...base.holdings.filter(
      (each) => each.holding.asset_class !== "instrument",
    ),
  ];
  return {
    ...base,
    instruments,
    holdings,
    movements,
    nextEntryOrder: made,
    revisions: new Map([...movements.keys()].map((id) => [id, 0])),
    quotes: { fxRates, prices },
    manualPrices,
  };
}
