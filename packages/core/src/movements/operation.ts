import {
  type Exact,
  exactOf,
  over,
  plus,
  roundedTo,
  times,
  toDecimal,
} from "@plant/shared";

import type { Charge } from "./movement";

// An operation's charges for each of its parts, by quantity: each part's share
// rounded to 8 decimals, the last taking what rounding left so each charge
// adds up to what was paid. A share that rounds to 0 is left out.
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
          ? plus(amount, { ...before, n: -before.n })
          : share(amount, exactOf(quantity), total);
      return part.n > 0n ? [{ ...charge, amount: toDecimal(part, 8) }] : [];
    }),
  );
}

const share = (amount: Exact, quantity: Exact, total: Exact): Exact =>
  roundedTo(over(times(amount, quantity), total), 8);
