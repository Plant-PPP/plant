import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import { operationInputSchema } from "@/lib/holdings/schemas";

import {
  movementRefusal,
  newMovementFields,
  operationFields,
  refusedMovementField,
  toOperationInput,
} from "./movement-fields";

const ACCOUNT = "a1000000-0000-4000-8000-000000000001";
const PRINCIPAL = "b1000000-0000-4000-8000-000000000001";
const LARGO = "b1000000-0000-4000-8000-000000000002";
const defaults = {
  kind: "purchase" as const,
  accountId: ACCOUNT,
  instrument: "BTC",
  currency: "USD" as const,
  date: "2026-10-12",
  portfolioId: PRINCIPAL,
};

it("sends one purchase split across portfolios, with its charges", () => {
  const fields = {
    ...newMovementFields(defaults),
    price: "60000",
    parts: [
      { portfolioId: PRINCIPAL, size: "0,5" },
      { portfolioId: LARGO, size: "0,5" },
    ],
    charges: [
      { kind: "commission" as const, label: "", amount: "10" },
      { kind: "vat" as const, label: "", amount: "2,1" },
      { kind: "other" as const, label: "Custodia", amount: "1" },
    ],
    reference: " BIN-1 ",
  };
  expect(
    operationInputSchema.parse(toOperationInput(fields, "crypto")),
  ).toEqual({
    kind: "purchase",
    source_connection_id: ACCOUNT,
    instrument_symbol: "BTC",
    date: "2026-10-12",
    currency: "USD",
    price: "60000",
    parts: [
      { portfolio_id: PRINCIPAL, quantity: "0.5" },
      { portfolio_id: LARGO, quantity: "0.5" },
    ],
    charges: [
      { kind: "commission", label: null, amount: "10" },
      { kind: "vat", label: null, amount: "2.1" },
      { kind: "other", label: "Custodia", amount: "1" },
    ],
    reference: "BIN-1",
    note: null,
  });
});

it("sends an income's parts as amounts, and an adjustment out at no cost", () => {
  const coupon = {
    ...newMovementFields({ ...defaults, kind: "coupon" }),
    parts: [{ portfolioId: PRINCIPAL, size: "120" }],
  };
  expect(toOperationInput(coupon, "crypto").parts).toEqual([
    { portfolio_id: PRINCIPAL, amount: "120" },
  ]);
  const out = {
    ...newMovementFields({ ...defaults, kind: "adjustment" }),
    direction: "out" as const,
    price: "999",
    parts: [{ portfolioId: PRINCIPAL, size: "1" }],
  };
  expect(
    operationInputSchema.parse(toOperationInput(out, "crypto")),
  ).toMatchObject({
    direction: "out",
    price: "0",
  });
});

it("starts an opening balance with the holding's amount", () => {
  expect(
    newMovementFields({ ...defaults, kind: "opening_balance", size: "0.5" })
      .parts,
  ).toEqual([{ portfolioId: PRINCIPAL, size: "0,5" }]);
});

it("reads an operation back from its parts, adding up each charge", () => {
  const rates = {
    mep: { sell: "1", date: "2026-03-02" },
    ccl: { sell: "1", date: "2026-03-02" },
    official: { sell: "1", date: "2026-03-02" },
  };
  const part = (id: string, quantity: string, commission: string) => ({
    id,
    holding_id: `h-${id}`,
    operation_id: "op",
    entry_order: 1,
    kind: "sale" as const,
    date: "2026-03-02",
    currency: "USD" as const,
    quantity,
    price: "100",
    charges: [{ kind: "commission" as const, label: null, amount: commission }],
    reference: "R-9",
    note: null,
    rates,
  });
  const fields = operationFields(
    [
      { movement: part("m1", "1", "3.33333333"), portfolioId: PRINCIPAL },
      { movement: part("m2", "2", "6.66666667"), portfolioId: LARGO },
    ],
    { accountId: ACCOUNT, instrument: "BTC", type: "crypto" },
  );
  expect(fields).toMatchObject({
    kind: "sale",
    price: "100",
    reference: "R-9",
    parts: [
      { portfolioId: PRINCIPAL, size: "1" },
      { portfolioId: LARGO, size: "2" },
    ],
    charges: [{ kind: "commission", label: "", amount: "10" }],
  });
});

it("points at the first refused field in the form's order", () => {
  const fields = {
    ...newMovementFields(defaults),
    price: "x",
    parts: [{ portfolioId: PRINCIPAL, size: "0" }],
  };
  const parsed = operationInputSchema.safeParse(
    toOperationInput(fields, "crypto"),
  );
  if (parsed.success) throw new Error("expected a refusal");
  expect(movementRefusal(parsed.error).field).toBe("price");
});

it("points a refused write at its field", () => {
  expect(refusedMovementField(MOVEMENT_MESSAGES.oversold)).toBe("parts");
  expect(refusedMovementField(MOVEMENT_MESSAGES.future_date)).toBe("date");
  expect(refusedMovementField(MOVEMENT_MESSAGES.no_rate)).toBe("date");
  expect(refusedMovementField(MOVEMENT_MESSAGES.opening_balance)).toBe("kind");
  expect(refusedMovementField(MOVEMENT_MESSAGES.failed)).toBeNull();
});

it("takes a bond's price as quoted, per 100 nominal, and sends it per unit", () => {
  const bond = {
    ...newMovementFields({ ...defaults, instrument: "AL30", currency: "ARS" }),
    price: "85,5",
    parts: [{ portfolioId: PRINCIPAL, size: "1000" }],
  };
  expect(toOperationInput(bond, "bond")).toMatchObject({ price: "0.855" });
  const rates = {
    mep: { sell: "1", date: "2026-03-02" },
    ccl: { sell: "1", date: "2026-03-02" },
    official: { sell: "1", date: "2026-03-02" },
  };
  const purchase = {
    id: "m1",
    holding_id: "h1",
    operation_id: "op",
    entry_order: 1,
    kind: "purchase" as const,
    date: "2026-03-02",
    currency: "ARS" as const,
    quantity: "1000",
    price: "0.855",
    charges: [],
    reference: null,
    note: null,
    rates,
  };
  expect(
    operationFields([{ movement: purchase, portfolioId: PRINCIPAL }], {
      accountId: ACCOUNT,
      instrument: "AL30",
      type: "bond",
    }).price,
  ).toBe("85,5");
});
