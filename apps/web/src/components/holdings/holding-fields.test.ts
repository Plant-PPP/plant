import { classBranch } from "@plant/core";
import { z } from "zod";

import type { HoldingRow } from "@/lib/holdings/read";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import {
  holdingInsertSchema,
  holdingUpdateSchema,
} from "@/lib/holdings/schemas";

import {
  FIELD_MESSAGES,
  FIELDS_BY_CLASS,
  type HoldingFields,
  MATURITY_MESSAGE,
  holdingRow,
  rowOf,
  initialFields,
  refusal,
  refusedField,
  toInsert,
  toUpdate,
} from "./holding-fields";
import type { AssetClass } from "@/lib/holdings/messages";

const ACCOUNT = "a1000000-0000-4000-8000-0000000000a1";
const PORTFOLIO = "b1000000-0000-4000-8000-0000000000b1";
const OTHER_PORTFOLIO = "b2000000-0000-4000-8000-0000000000b2";
const TODAY = "2026-10-10";
const CLASSES = Object.keys(FIELDS_BY_CLASS) as AssetClass[];

const base: HoldingFields = {
  ...initialFields(null, {
    accountId: ACCOUNT,
    portfolioId: PORTFOLIO,
    today: TODAY,
  }),
};

// One sample the dialog could hold for each class.
const SAMPLES: Record<AssetClass, HoldingFields> = {
  instrument: {
    ...base,
    assetClass: "instrument",
    instrument: "BTC",
    amount: "0,5",
  },
  cash: { ...base, assetClass: "cash", currency: "USD", amount: "1500" },
  fixed_term: {
    ...base,
    assetClass: "fixed_term",
    currency: "ARS",
    amount: "100000",
    rate: "35,5",
    startedOn: "2026-10-01",
    maturesOn: "2026-10-31",
    label: "Galicia",
  },
  real_estate: {
    ...base,
    assetClass: "real_estate",
    currency: "USD",
    amount: "90000",
    valuedOn: "2026-10-01",
    label: "Depto",
  },
  other: {
    ...base,
    assetClass: "other",
    currency: "ARS",
    amount: "3.000.000",
    valuedOn: "2026-10-01",
    label: "Auto",
  },
};

const CHOSEN = {
  account: { id: ACCOUNT, institution: "IOL" },
  portfolio: { id: PORTFOLIO, name: "Principal" },
  instrumentType: null,
};

describe.each(CLASSES)("a %s holding", (assetClass) => {
  const fields = SAMPLES[assetClass];

  it("lists exactly the columns its class fills (parity with core)", () => {
    const shape = classBranch(assetClass).shape as Record<string, z.ZodType>;
    const filled = Object.keys(shape).filter(
      (key) => key !== "asset_class" && !(shape[key] instanceof z.ZodNull),
    );
    expect([...FIELDS_BY_CLASS[assetClass]].sort()).toEqual(filled.sort());
  });

  it("sends an insert the write schema takes", () => {
    expect(holdingInsertSchema.safeParse(toInsert(fields)).success).toBe(true);
  });

  it("sends an update the write schema takes", () => {
    expect(
      holdingUpdateSchema.safeParse(toUpdate(fields, PORTFOLIO)).success,
    ).toBe(true);
    expect(
      holdingUpdateSchema.safeParse(toUpdate(fields, OTHER_PORTFOLIO)).success,
    ).toBe(true);
  });

  it("round-trips through the row the page shows", () => {
    const row: HoldingRow = holdingRow("h1", fields, CHOSEN);
    const back = initialFields(row, {
      accountId: "",
      portfolioId: "",
      today: TODAY,
    });
    expect(toInsert(back)).toEqual(toInsert(fields));
  });

  it("lists a holding from columns the schema accepted, in the chosen portfolio", () => {
    expect(rowOf("h1", toInsert(fields), CHOSEN)).toEqual(
      holdingRow("h1", fields, CHOSEN),
    );
    expect(rowOf("h1", toInsert(fields), CHOSEN).holding.portfolio_id).toBe(
      CHOSEN.portfolio.id,
    );
  });
});

it("sends the portfolio only when it moved", () => {
  expect(toUpdate(SAMPLES.cash, PORTFOLIO)).not.toHaveProperty("portfolio_id");
  expect(toUpdate(SAMPLES.cash, OTHER_PORTFOLIO)).toHaveProperty(
    "portfolio_id",
    PORTFOLIO,
  );
  expect(toUpdate(SAMPLES.instrument, PORTFOLIO)).not.toHaveProperty(
    "instrument_symbol",
  );
});

it("sends an empty optional label as null", () => {
  expect(toInsert({ ...SAMPLES.cash, label: "  " }).label).toBeNull();
});

it.each([
  [{ ...SAMPLES.cash, amount: "" }, "amount", FIELD_MESSAGES.amount],
  [{ ...SAMPLES.cash, amount: "abc" }, "amount", FIELD_MESSAGES.amount],
  [{ ...SAMPLES.cash, amount: "1.234" }, "amount", FIELD_MESSAGES.amount],
  [{ ...SAMPLES.fixed_term, rate: "35.125" }, "rate", FIELD_MESSAGES.rate],
  [
    { ...SAMPLES.cash, currency: "" as const },
    "currency",
    FIELD_MESSAGES.currency,
  ],
  [
    { ...SAMPLES.instrument, instrument: "" },
    "instrument",
    FIELD_MESSAGES.instrument,
  ],
  [{ ...SAMPLES.fixed_term, rate: "2000" }, "rate", FIELD_MESSAGES.rate],
  [
    { ...SAMPLES.fixed_term, maturesOn: "2026-09-30" },
    "maturesOn",
    MATURITY_MESSAGE,
  ],
  [
    { ...SAMPLES.other, valuedOn: "1899-12-31" },
    "valuedOn",
    FIELD_MESSAGES.valuedOn,
  ],
  [{ ...SAMPLES.other, label: "" }, "label", FIELD_MESSAGES.label],
  [{ ...SAMPLES.cash, accountId: "" }, "account", FIELD_MESSAGES.account],
] as const)("maps a refused field to its alert %#", (fields, field, text) => {
  const parsed = holdingInsertSchema.safeParse(toInsert(fields));
  expect(parsed.success).toBe(false);
  expect(refusal(parsed.error!)).toEqual({ field, text });
});

it("words the rate's bound as a percent", () => {
  expect(FIELD_MESSAGES.rate).toBe(
    "La TNA va de 0 a 1000%, con coma para los decimales: 35,5.",
  );
  expect(FIELD_MESSAGES.valuedOn).toBe("Usá una fecha entre 1900 y 9999.");
});

it("points a duplicate at the instrument on create, the portfolio on edit", () => {
  const text = WRITE_MESSAGES.holdings.duplicate;
  expect(refusedField("create", text)).toBe("instrument");
  expect(refusedField("edit", text)).toBe("portfolio");
});

it("asks for a date left empty rather than its range", () => {
  const parsed = holdingInsertSchema.safeParse(
    toInsert({ ...SAMPLES.fixed_term, maturesOn: "" }),
  );
  expect(refusal(parsed.error!)).toEqual({
    field: "maturesOn",
    text: "Elegí la fecha de vencimiento.",
  });
});

it("points at the first refused field in the dialog's order", () => {
  const parsed = holdingInsertSchema.safeParse(
    toInsert({ ...SAMPLES.cash, accountId: "", currency: "", amount: "" }),
  );
  expect(refusal(parsed.error!).field).toBe("account");
});
