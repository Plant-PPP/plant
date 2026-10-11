import { liabilityInputSchema } from "@plant/core";

import type { WriteResult } from "@/lib/portfolio-setup/write-result";

import type { PrototypeState, Write } from "./prototype-store";

const refused = (
  state: PrototypeState,
  code: Extract<WriteResult, { ok: false }>["code"],
): Write<WriteResult> => ({ state, result: { ok: false, code } });

export function createLiability(
  state: PrototypeState,
  input: unknown,
  id: string,
): Write<WriteResult> {
  const parsed = liabilityInputSchema.safeParse(input);
  if (!parsed.success) return refused(state, "invalid");
  return {
    state: {
      ...state,
      liabilities: [{ id, ...parsed.data }, ...state.liabilities],
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
  if (!parsed.success) return refused(state, "invalid");
  if (!state.liabilities.some((each) => each.id === id)) {
    return refused(state, "not_found");
  }
  return {
    state: {
      ...state,
      liabilities: state.liabilities.map((each) =>
        each.id === id ? { id, ...parsed.data } : each,
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
    return refused(state, "not_found");
  }
  return {
    state: {
      ...state,
      liabilities: state.liabilities.filter((each) => each.id !== id),
    },
    result: { ok: true, id },
  };
}
