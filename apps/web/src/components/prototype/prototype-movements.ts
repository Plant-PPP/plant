import type { MovementsInput } from "@/lib/holdings/movements-input";

import {
  movementsPage,
  priceOn,
  type PrototypeState,
  suggestedTransferCost,
} from "./prototype-store";

// What every page with movements reads from the prototype's store as it is
// when the page asks, not as it was when the page rendered.
export function prototypeMovementsInput(
  latest: () => PrototypeState,
): Pick<MovementsInput, "loadMovements" | "transferCost" | "quoteOn"> {
  return {
    loadMovements: async (scope, unit, cursor) =>
      movementsPage(latest(), scope, unit, cursor),
    transferCost: (query) => suggestedTransferCost(latest(), query),
    quoteOn: (query) => priceOn(latest(), query),
  };
}
