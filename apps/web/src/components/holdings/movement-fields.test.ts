import type { Movement } from "@plant/core";

import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import { operationInputSchema } from "@/lib/holdings/schemas";

import {
  MOVEMENT_FIELD_MESSAGES,
  type MovementFields,
  movementRefusal,
  newMovementFields,
  operationFields,
  refusedMovementField,
  kindsOffered,
  toOperationInput,
  withKind,
  withShownPrice,
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
    note: " Por la tarde ",
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
    note: "Por la tarde",
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
  expect(
    movementRefusal(parsed.error, { kind: "purchase", balance: null }).field,
  ).toBe("price");
});

it("points a refused write at its field", () => {
  expect(refusedMovementField(MOVEMENT_MESSAGES.oversold)).toBe("parts");
  expect(refusedMovementField(MOVEMENT_MESSAGES.same_balance)).toBe("parts");
  expect(refusedMovementField(MOVEMENT_MESSAGES.not_found)).toBe("parts");
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

describe("a transfer", () => {
  const rates = {
    mep: { sell: "1", date: "2026-03-02" },
    ccl: { sell: "1", date: "2026-03-02" },
    official: { sell: "1", date: "2026-03-02" },
  };
  const leg = (direction: "in" | "out", price: string | null): Movement => ({
    id: `m-${direction}`,
    holding_id: `h-${direction}`,
    operation_id: "op",
    entry_order: 1,
    kind: "transfer" as const,
    direction,
    date: "2026-03-02",
    currency: "USD" as const,
    quantity: "0.5",
    price,
    charges: [],
    reference: null,
    note: null,
    rates,
  });
  const moving = withKind(
    {
      ...newMovementFields(defaults),
      parts: [{ portfolioId: LARGO, size: "0,5" }],
    },
    "transfer",
    { transfer: PRINCIPAL },
  );

  it("starts from its portfolio with the quantity typed, no charges and the cost it carries", () => {
    expect(moving).toMatchObject({
      kind: "transfer",
      priceEdited: false,
      price: "",
      charges: [],
      parts: [
        { portfolioId: PRINCIPAL, size: "0,5" },
        { portfolioId: "", size: "0,5" },
      ],
    });
    expect(withKind(moving, "purchase", {}).parts).toEqual([
      { portfolioId: PRINCIPAL, size: "0,5" },
    ]);
  });

  it("sends one quantity each way, carrying the cost until it is changed", () => {
    const fields = {
      ...moving,
      parts: [moving.parts[0]!, { portfolioId: LARGO, size: "0,5" }],
    };
    const input = (each: typeof fields) =>
      operationInputSchema.parse(toOperationInput(each, "crypto"));
    expect(input(fields).parts).toEqual([
      {
        portfolio_id: PRINCIPAL,
        direction: "out",
        quantity: "0.5",
        price: null,
      },
      { portfolio_id: LARGO, direction: "in", quantity: "0.5", price: null },
    ]);
    expect(
      input({ ...fields, price: "61000", priceEdited: true }).parts[1],
    ).toMatchObject({ price: "61000" });
    expect(input({ ...fields, price: "61000" }).parts[1]).toMatchObject({
      price: null,
    });
  });

  it("carries the cost again once a changed one is cleared", () => {
    const fields = {
      ...moving,
      parts: [moving.parts[0]!, { portfolioId: LARGO, size: "0,5" }],
      price: " ",
      priceEdited: true,
    };
    expect(
      operationInputSchema.parse(toOperationInput(fields, "crypto")).parts[1],
    ).toMatchObject({ price: null });
  });

  it("keeps every part and the price changing between other kinds", () => {
    const split = {
      ...newMovementFields(defaults),
      price: "5",
      parts: [
        { portfolioId: PRINCIPAL, size: "1" },
        { portfolioId: LARGO, size: "2" },
      ],
    };
    expect(withKind(split, "sale", {})).toEqual({
      ...split,
      kind: "sale",
    });
  });

  it("keeps its source when it stops being a transfer, whatever homes the dialog names", () => {
    expect(
      withKind(moving, "purchase", { transfer: LARGO, yield: LARGO }).parts,
    ).toEqual([{ portfolioId: PRINCIPAL, size: "0,5" }]);
  });

  it("drops a changed cost when it stops being a transfer", () => {
    expect(
      withKind(
        { ...moving, price: "61000", priceEdited: true },
        "purchase",
        {},
      ),
    ).toMatchObject({ price: "", priceEdited: false });
  });

  it.each(["1.234"])(
    "refuses a changed cost %s that reads two ways, naming the price",
    (price) => {
      const parsed = operationInputSchema.safeParse(
        toOperationInput(
          {
            ...moving,
            parts: [moving.parts[0]!, { portfolioId: LARGO, size: "0,5" }],
            price,
            priceEdited: true,
          },
          "crypto",
        ),
      );
      if (parsed.success) throw new Error("expected a refusal");
      expect(
        movementRefusal(parsed.error, { kind: "transfer", balance: null })
          .field,
      ).toBe("price");
    },
  );

  it("names a changed cost that does not parse as the price", () => {
    const parsed = operationInputSchema.safeParse(
      toOperationInput(
        {
          ...moving,
          parts: [moving.parts[0]!, { portfolioId: LARGO, size: "0,5" }],
          price: "x",
          priceEdited: true,
        },
        "crypto",
      ),
    );
    if (parsed.success) throw new Error("expected a refusal");
    expect(
      movementRefusal(parsed.error, { kind: "transfer", balance: null }).field,
    ).toBe("price");
  });

  it.each([
    ["leaving first", [leg("out", null), leg("in", "61000")]],
    ["arriving first", [leg("in", "61000"), leg("out", null)]],
  ])("reads back with its side %s", (_, legs) => {
    const fields = operationFields(
      legs.map((movement) => ({
        movement,
        portfolioId: movement.id === "m-out" ? PRINCIPAL : LARGO,
      })),
      { accountId: ACCOUNT, instrument: "BTC", type: "crypto" },
    );
    expect(fields).toMatchObject({
      kind: "transfer",
      priceEdited: true,
      price: "61000",
      parts: [
        { portfolioId: PRINCIPAL, size: "0,5" },
        { portfolioId: LARGO, size: "0,5" },
      ],
    });
  });

  it("reads back a carried cost as not changed", () => {
    expect(
      operationFields(
        [
          { movement: leg("out", null), portfolioId: PRINCIPAL },
          { movement: leg("in", null), portfolioId: LARGO },
        ],
        { accountId: ACCOUNT, instrument: "BTC", type: "crypto" },
      ),
    ).toMatchObject({ priceEdited: false, price: "" });
  });
});

it("points an archived home's refusal at its field", () => {
  expect(refusedMovementField(MOVEMENT_MESSAGES.portfolio_archived)).toBe(
    "parts",
  );
  expect(
    refusedMovementField(MOVEMENT_MESSAGES.source_connection_archived),
  ).toBeNull();
});

describe("the kinds offered", () => {
  const ALL = new Set(["transfer", "yield"] as const);
  const NONE = new Set<never>();

  it("offers a transfer only on a new operation where the page takes them", () => {
    expect(kindsOffered({ editing: null, offers: ALL })).toContain("transfer");
    expect(kindsOffered({ editing: null, offers: NONE })).not.toContain(
      "transfer",
    );
    expect(kindsOffered({ editing: "purchase", offers: ALL })).not.toContain(
      "transfer",
    );
  });

  it("offers a yield where the page takes them, new or edited", () => {
    expect(kindsOffered({ editing: null, offers: ALL })).toContain("yield");
    expect(kindsOffered({ editing: "sale", offers: ALL })).toContain("yield");
    expect(kindsOffered({ editing: null, offers: NONE })).not.toContain(
      "yield",
    );
    expect(kindsOffered({ editing: "yield", offers: NONE })).toContain("yield");
  });

  it("keeps an edited transfer one", () => {
    expect(kindsOffered({ editing: "transfer", offers: ALL })).toEqual([
      "transfer",
    ]);
  });
});

describe("a yield's fields", () => {
  const earning = withKind(
    {
      ...newMovementFields(defaults),
      price: "60000",
      parts: [
        { portfolioId: PRINCIPAL, size: "0,5" },
        { portfolioId: LARGO, size: "1" },
      ],
      charges: [{ kind: "commission" as const, label: "", amount: "1" }],
    },
    "yield",
    { yield: PRINCIPAL },
  );
  const input = (fields: typeof earning) =>
    operationInputSchema.parse(toOperationInput(fields, "crypto"));

  it("keeps one portfolio, with no charges and no price until the dialog suggests one", () => {
    expect(earning).toMatchObject({
      kind: "yield",
      price: "",
      priceEdited: false,
      balance: null,
      charges: [],
      parts: [{ portfolioId: PRINCIPAL, size: "0,5" }],
    });
  });

  it("sends the units earned or lost at the value typed", () => {
    const lost = { ...earning, direction: "out" as const, price: "61.000,5" };
    expect(input(lost)).toEqual({
      kind: "yield",
      source_connection_id: ACCOUNT,
      instrument_symbol: "BTC",
      date: "2026-10-12",
      currency: "USD",
      price: "61000.5",
      parts: [{ portfolio_id: PRINCIPAL, direction: "out", quantity: "0.5" }],
      reference: null,
      note: null,
    });
  });

  it("sends the balance at the end of the day instead of the units", () => {
    expect(input({ ...earning, price: "60000", balance: "2,5" }).parts).toEqual(
      [{ portfolio_id: PRINCIPAL, balance: "2.5" }],
    );
  });

  it.each([
    ["no value", { price: "" }, "price"],
    ["a balance that does not parse", { price: "1", balance: "x" }, "parts"],
  ] as const)("refuses %s, naming its field", (_, change, field) => {
    const fields = { ...earning, ...change };
    const parsed = operationInputSchema.safeParse(
      toOperationInput(fields, "crypto"),
    );
    if (parsed.success) throw new Error("expected a refusal");
    expect(movementRefusal(parsed.error, fields).field).toBe(field);
  });

  it.each([
    ["no value", { price: "" }, "price", "Ingresá un valor de 0 o más."],
    [
      "no units",
      { price: "1", parts: [{ portfolioId: PRINCIPAL, size: "" }] },
      "parts",
      "Ingresá una cantidad mayor a 0.",
    ],
    [
      "no balance",
      { price: "1", balance: "" },
      "parts",
      "Ingresá un saldo final de 0 o más.",
    ],
    [
      "a negative balance",
      { price: "1", balance: "-1" },
      "parts",
      "Ingresá un saldo final de 0 o más.",
    ],
  ] as const)(
    "asks for what is missing in its words: %s",
    (_, change, field, text) => {
      const fields: MovementFields = {
        ...earning,
        ...change,
        parts: "parts" in change ? [...change.parts] : earning.parts,
      };
      const parsed = operationInputSchema.safeParse(
        toOperationInput(fields, "crypto"),
      );
      if (parsed.success) throw new Error("expected a refusal");
      expect(movementRefusal(parsed.error, fields)).toEqual({ field, text });
    },
  );

  it("keeps the other kinds' words", () => {
    const fields = { ...newMovementFields(defaults), price: "1" };
    const parsed = operationInputSchema.safeParse(
      toOperationInput(fields, "crypto"),
    );
    if (parsed.success) throw new Error("expected a refusal");
    expect(movementRefusal(parsed.error, fields)).toEqual({
      field: "parts",
      text: MOVEMENT_FIELD_MESSAGES.parts,
    });
  });

  it("is the holding's portfolio, whatever the part showed", () => {
    expect(
      withKind(
        {
          ...newMovementFields(defaults),
          parts: [{ portfolioId: LARGO, size: "5" }],
        },
        "yield",
        { yield: PRINCIPAL },
      ).parts,
    ).toEqual([{ portfolioId: PRINCIPAL, size: "5" }]);
  });

  it("sends a bond's value as it shows it, per 100 nominal", () => {
    const sent = withShownPrice(
      { ...earning, instrument: "AL30" },
      "0.65432199",
      "bond",
    );
    expect(sent.price).toBe("65,432199");
    expect(toOperationInput(sent, "bond")).toMatchObject({
      price: "0.65432199",
    });
  });

  it("reads a loss back as a loss, with its value as typed", () => {
    const movement: Movement = {
      id: "y1",
      holding_id: "h1",
      operation_id: "op",
      entry_order: 1,
      kind: "yield",
      direction: "out",
      date: "2026-03-02",
      currency: "USD",
      quantity: "0.5",
      price: "61000",
      charges: [],
      reference: null,
      note: null,
      rates: {
        mep: { sell: "1", date: "2026-03-02" },
        ccl: { sell: "1", date: "2026-03-02" },
        official: { sell: "1", date: "2026-03-02" },
      },
    };
    const fields = operationFields([{ movement, portfolioId: PRINCIPAL }], {
      accountId: ACCOUNT,
      instrument: "BTC",
      type: "crypto",
    });
    expect(fields).toMatchObject({
      kind: "yield",
      direction: "out",
      price: "61000",
      priceEdited: true,
      balance: null,
    });
    expect(input(fields).parts).toEqual([
      { portfolio_id: PRINCIPAL, direction: "out", quantity: "0.5" },
    ]);
  });

  it("sends the day's quote it shows until the user types a value", () => {
    // Not marked as typed, so a dialog opened again follows the new day's.
    expect(withShownPrice(earning, "61000.5", "crypto")).toEqual({
      ...earning,
      price: "61000,5",
    });
    const typed = { ...earning, price: "1", priceEdited: true };
    expect(withShownPrice(typed, "61000.5", "crypto")).toEqual(typed);
    expect(withShownPrice(earning, null, "crypto")).toEqual(earning);
    const moving = withKind(earning, "transfer", { transfer: PRINCIPAL });
    expect(withShownPrice(moving, "61000.5", "crypto")).toBe(moving);
  });

  it("sends no value it does not show once the day has no quote", () => {
    const reopened = withShownPrice(earning, "61000.5", "crypto");
    const sent = withShownPrice(reopened, null, "crypto");
    expect(sent.price).toBe("");
    expect(
      operationInputSchema.safeParse(toOperationInput(sent, "crypto")).success,
    ).toBe(false);
  });

  it("goes into the portfolio named for its kind, else the first part's", () => {
    const other = {
      ...newMovementFields(defaults),
      parts: [{ portfolioId: LARGO, size: "1" }],
    };
    const homes = { transfer: "t", yield: PRINCIPAL };
    expect(withKind(other, "yield", homes).parts).toEqual([
      { portfolioId: PRINCIPAL, size: "1" },
    ]);
    expect(withKind(other, "transfer", homes).parts[0]).toEqual({
      portfolioId: "t",
      size: "1",
    });
    expect(withKind(other, "yield", { transfer: "t" }).parts).toEqual([
      { portfolioId: LARGO, size: "1" },
    ]);
  });

  it("leaves the balance and the value behind as another kind", () => {
    expect(
      withKind(
        { ...earning, price: "1", priceEdited: true, balance: "3" },
        "purchase",
        {},
      ),
    ).toMatchObject({ price: "", priceEdited: false, balance: null });
  });
});
