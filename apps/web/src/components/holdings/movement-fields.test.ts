import { movementInputSchema } from "@/lib/holdings/schemas";
import { without } from "@/test/without";
import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";

import {
  initialMovementFields,
  movementRefusal,
  refusedMovementField,
  toMovementInput,
} from "./movement-fields";

const HOLDING = "c1000000-0000-4000-8000-000000000001";
const defaults = {
  kind: "purchase" as const,
  holdingId: HOLDING,
  currency: "USD" as const,
  date: "2026-10-12",
};

it("sends a trade with its quantity, price and empty charges as 0", () => {
  const fields = {
    ...initialMovementFields(null, defaults),
    quantity: "1.234,5",
    price: "10,25",
  };
  expect(movementInputSchema.parse(toMovementInput(fields))).toEqual({
    holding_id: HOLDING,
    kind: "purchase",
    date: "2026-10-12",
    currency: "USD",
    quantity: "1234.5",
    price: "10.25",
    fees: "0",
    taxes: "0",
  });
});

it("sends income as an amount only", () => {
  const fields = {
    ...initialMovementFields(null, { ...defaults, kind: "coupon" }),
    amount: "120",
  };
  expect(toMovementInput(fields)).not.toHaveProperty("quantity");
  expect(movementInputSchema.parse(toMovementInput(fields))).toMatchObject({
    kind: "coupon",
    amount: "120",
  });
});

it("starts an opening balance with the holding's amount", () => {
  expect(
    initialMovementFields(null, {
      ...defaults,
      kind: "opening_balance",
      quantity: "0.5",
    }).quantity,
  ).toBe("0,5");
});

it("reads a movement back into the same input", () => {
  const input = {
    id: "m1",
    holding_id: HOLDING,
    kind: "sale" as const,
    date: "2026-03-02",
    currency: "ARS" as const,
    quantity: "5",
    price: "1200.5",
    fees: "10",
    taxes: "2",
    rates: {
      mep: { sell: "1", date: "2026-03-02" },
      ccl: { sell: "1", date: "2026-03-02" },
      official: { sell: "1", date: "2026-03-02" },
    },
  };
  expect(toMovementInput(initialMovementFields(input, defaults))).toEqual(
    without(input, "id", "rates"),
  );
});

it("points at the first refused field in the form's order", () => {
  const fields = {
    ...initialMovementFields(null, defaults),
    quantity: "0",
    price: "x",
    fees: "-1",
  };
  const parsed = movementInputSchema.safeParse(toMovementInput(fields));
  if (parsed.success) throw new Error("expected a refusal");
  expect(movementRefusal(parsed.error).field).toBe("quantity");
});

it("points a refused write at its field", () => {
  expect(refusedMovementField(MOVEMENT_MESSAGES.oversold)).toBe("quantity");
  expect(refusedMovementField(MOVEMENT_MESSAGES.future_date)).toBe("date");
  expect(refusedMovementField(MOVEMENT_MESSAGES.no_rate)).toBe("date");
  expect(refusedMovementField(MOVEMENT_MESSAGES.opening_balance)).toBe("kind");
  expect(refusedMovementField(MOVEMENT_MESSAGES.failed)).toBeNull();
});
