import type { Movement } from "@plant/core";

import { shownPrice } from "./price-input";

it("shows a trade's price and no price for a transfer or an income", () => {
  const of = (kind: string, price: string | null) =>
    ({ kind, quantity: "1", price }) as unknown as Movement;
  expect(shownPrice(of("purchase", "100"))).toBe("100");
  expect(shownPrice(of("transfer", "100"))).toBeNull();
  expect(
    shownPrice({ kind: "dividend", amount: "5" } as unknown as Movement),
  ).toBeNull();
});
