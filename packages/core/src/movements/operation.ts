import { exactOf, splitExact, stored } from "@plant/shared";

import type { Charge } from "./movement";

// An operation's charges for each of its parts, by quantity: each part's share
// cut to 8 decimals, the last taking what the cuts left, so each charge adds
// up to what was paid and no part is negative. A share of 0 is left out.
export function splitCharges(
  charges: readonly Charge[],
  quantities: readonly string[],
): Charge[][] {
  if (quantities.length === 0) return [];
  const weights = quantities.map(exactOf);
  const parts = charges.map((charge) =>
    splitExact(exactOf(charge.amount), weights),
  );
  return quantities.map((_, index) =>
    charges.flatMap((charge, chargeIndex) => {
      const part = parts[chargeIndex]![index]!;
      return part.n > 0n ? [{ ...charge, amount: stored(part) }] : [];
    }),
  );
}
