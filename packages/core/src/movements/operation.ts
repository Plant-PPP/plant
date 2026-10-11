import {
  type Exact,
  exactOf,
  minus,
  over,
  plus,
  times,
  toDecimal,
} from "@plant/shared";

import type { Charge } from "./movement";

// An operation's charges for each of its parts, by quantity: each part's share
// cut to 8 decimals, the last taking what the cuts left, so each charge adds
// up to what was paid and no part is negative. A share of 0 is left out.
export function splitCharges(
  charges: readonly Charge[],
  quantities: readonly string[],
): Charge[][] {
  const total = plus(...quantities.map(exactOf));
  return quantities.map((quantity, index) =>
    charges.flatMap((charge) => {
      const amount = exactOf(charge.amount);
      const before = plus(
        ...quantities
          .slice(0, index)
          .map((each) => share(amount, exactOf(each), total)),
      );
      const part =
        index === quantities.length - 1
          ? minus(amount, before)
          : share(amount, exactOf(quantity), total);
      return part.n > 0n ? [{ ...charge, amount: toDecimal(part, 8) }] : [];
    }),
  );
}

const UNIT = 10n ** 8n;

// Truncated toward zero, so the early parts never add up to more than the
// charge.
function share(amount: Exact, quantity: Exact, total: Exact): Exact {
  const exact = over(times(amount, quantity), total);
  return { n: (exact.n * UNIT) / exact.d, d: UNIT };
}
