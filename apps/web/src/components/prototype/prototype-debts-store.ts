import { liabilityInputSchema } from "@plant/core";

import type { WriteResult } from "@/lib/portfolio-setup/write-result";

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
  if (!state.liabilities.some((each) => each.id === id)) {
    return refusedWrite(state, "not_found");
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
              anchored_on:
                parsed.data.opened_on ??
                (each.opened_on === null ? each.anchored_on : state.today),
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
