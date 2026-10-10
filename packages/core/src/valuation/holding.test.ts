import { toDecimal } from "@plant/shared";
import { lastConstraint } from "@plant/shared/testing";
import { SNAPSHOT } from "./fixtures.test-support";
import {
  MAX_ANNUAL_RATE,
  holdingSchema,
  instrumentValue,
  valueHolding,
} from "./holding";

const base = {
  id: "h",
  portfolio_id: "p",
  instrument_symbol: null,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

const holding = (fields: Record<string, unknown>) =>
  holdingSchema.parse({ ...base, ...fields });

const fixedTerm = (amount: string, started_on: string, matures_on: string) =>
  holding({
    asset_class: "fixed_term",
    amount,
    currency: "ARS",
    annual_rate: "0.35",
    started_on,
    matures_on,
  });

function shown(value: ReturnType<typeof valueHolding>) {
  if ("missing" in value) throw new Error(value.missing);
  return {
    amount: toDecimal(value.money.amount, 8),
    currency: value.money.currency,
    asOf: value.asOf,
    state: value.state,
  };
}

describe("valueHolding", () => {
  it("prices an instrument at its quote, in the quote's currency", () => {
    expect(
      shown(
        valueHolding(
          holding({
            asset_class: "instrument",
            instrument_symbol: "BTC",
            amount: "0.5",
          }),
          SNAPSHOT,
        ),
      ),
    ).toEqual({
      amount: "32500",
      currency: "USD",
      asOf: "2026-10-12",
      state: undefined,
    });
  });

  it("dates an instrument by its price", () => {
    const stale = {
      ...SNAPSHOT,
      prices: {
        BTC: { price: "65000", currency: "USD" as const, date: "2026-10-11" },
      },
    };
    expect(
      shown(
        valueHolding(
          holding({
            asset_class: "instrument",
            instrument_symbol: "BTC",
            amount: "0.5",
          }),
          stale,
        ),
      ).asOf,
    ).toBe("2026-10-11");
  });

  it("names an instrument with no quote", () => {
    expect(
      valueHolding(
        holding({
          asset_class: "instrument",
          instrument_symbol: "SOL",
          amount: "1",
        }),
        SNAPSHOT,
      ),
    ).toEqual({ missing: "SOL" });
  });

  it("holds cash at its balance on the snapshot's day", () => {
    expect(
      shown(
        valueHolding(
          holding({ asset_class: "cash", amount: "120000", currency: "ARS" }),
          SNAPSHOT,
        ),
      ),
    ).toEqual({
      amount: "120000",
      currency: "ARS",
      asOf: "2026-10-12",
      state: undefined,
    });
  });

  it.each(["real_estate", "other"])(
    "holds %s at its stated value and date",
    (assetClass) => {
      expect(
        shown(
          valueHolding(
            holding({
              asset_class: assetClass,
              amount: "50000",
              currency: "USD",
              valued_on: "2026-09-01",
              label: "Depto",
            }),
            SNAPSHOT,
          ),
        ),
      ).toEqual({
        amount: "50000",
        currency: "USD",
        asOf: "2026-09-01",
        state: undefined,
      });
    },
  );

  describe("a fixed term at 35% TNA", () => {
    it("is its principal before it starts", () => {
      expect(
        shown(
          valueHolding(
            fixedTerm("100000", "2026-10-20", "2026-11-19"),
            SNAPSHOT,
          ),
        ),
      ).toEqual({
        amount: "100000",
        currency: "ARS",
        asOf: "2026-10-12",
        state: "not_started",
      });
    });

    // 100000 × 0.35 × 12 / 365 = 1150.684931… → 1150.68.
    it("accrues simple interest to the snapshot's day, in cents", () => {
      expect(
        shown(
          valueHolding(
            fixedTerm("100000", "2026-09-30", "2026-10-30"),
            SNAPSHOT,
          ),
        ),
      ).toEqual({
        amount: "101150.68",
        currency: "ARS",
        asOf: "2026-10-12",
        state: undefined,
      });
    });

    it("earns nothing on the day it starts", () => {
      expect(
        shown(
          valueHolding(
            fixedTerm("100000", "2026-10-12", "2026-11-11"),
            SNAPSHOT,
          ),
        ),
      ).toEqual({
        amount: "100000",
        currency: "ARS",
        asOf: "2026-10-12",
        state: undefined,
      });
    });

    // 100,000,000,000 × 10 × 365 / 365: interest past 12 integer digits.
    it("credits interest past the stored digits", () => {
      const large = holding({
        asset_class: "fixed_term",
        amount: "100000000000",
        currency: "ARS",
        annual_rate: MAX_ANNUAL_RATE,
        started_on: "2025-10-12",
        matures_on: "2026-10-12",
      });
      expect(shown(valueHolding(large, SNAPSHOT)).amount).toBe("1100000000000");
    });

    // 100.001 × 0.35 × 1 / 365 = 0.0958…: the interest is credited in cents,
    // not the principal.
    it("rounds the interest, not the principal", () => {
      expect(
        shown(
          valueHolding(
            fixedTerm("100.001", "2026-10-11", "2026-11-10"),
            SNAPSHOT,
          ),
        ).amount,
      ).toBe("100.101");
    });

    it.each([
      ["before it starts", "2026-10-20", "2026-11-19"],
      ["while it accrues", "2026-09-30", "2026-10-30"],
    ])("keeps its currency %s", (_, started_on, matures_on) => {
      const usd = holding({
        asset_class: "fixed_term",
        amount: "1000",
        currency: "USD",
        annual_rate: "0.35",
        started_on,
        matures_on,
      });
      expect(shown(valueHolding(usd, SNAPSHOT)).currency).toBe("USD");
    });

    // 36.5 × 0.35 × 1 / 365 = 0.035, half a cent, rounded away from zero.
    it("rounds a half cent of interest up", () => {
      expect(
        shown(
          valueHolding(fixedTerm("36.5", "2026-10-11", "2026-11-10"), SNAPSHOT),
        ).amount,
      ).toBe("36.54");
    });

    // 100000 × 0.35 × 30 / 365 = 2876.712328… → 2876.71, from the maturity day on.
    it.each(["2026-10-12", "2026-10-11"])(
      "stops accruing at maturity (%s)",
      (matures_on) => {
        const started =
          matures_on === "2026-10-12" ? "2026-09-12" : "2026-09-11";
        expect(
          shown(
            valueHolding(fixedTerm("100000", started, matures_on), SNAPSHOT),
          ),
        ).toEqual({
          amount: "102876.71",
          currency: "ARS",
          asOf: matures_on,
          state: "matured",
        });
      },
    );
  });
});

describe("holdingSchema", () => {
  it("refuses an amount read as a number", () => {
    expect(
      holdingSchema.safeParse({
        ...base,
        asset_class: "cash",
        amount: 5,
        currency: "ARS",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["matures the day it starts", { matures_on: "2026-10-01" }],
    ["has a date that is not ISO", { started_on: "2026-10-1" }],
  ])("refuses a fixed term that %s", (_, dates) => {
    expect(
      holdingSchema.safeParse({
        ...base,
        asset_class: "fixed_term",
        amount: "1",
        currency: "ARS",
        annual_rate: "0.35",
        started_on: "2026-10-01",
        matures_on: "2026-10-31",
        ...dates,
      }).success,
    ).toBe(false);
  });

  it.each(["0", "-1"])("refuses an amount of %s", (amount) => {
    expect(
      holdingSchema.safeParse({
        ...base,
        asset_class: "cash",
        amount,
        currency: "ARS",
      }).success,
    ).toBe(false);
  });

  it("refuses a fixed term that matures before it starts", () => {
    expect(
      holdingSchema.safeParse({
        ...base,
        asset_class: "fixed_term",
        amount: "1",
        currency: "ARS",
        annual_rate: "0.35",
        started_on: "2026-10-31",
        matures_on: "2026-10-01",
      }).success,
    ).toBe(false);
  });

  it("refuses a rate that is not a decimal, without throwing", () => {
    expect(
      holdingSchema.safeParse({
        ...base,
        asset_class: "fixed_term",
        amount: "1",
        currency: "ARS",
        annual_rate: "35%",
        started_on: "2026-10-01",
        matures_on: "2026-10-31",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["-0.1", false],
    ["0", true],
    ["10", true],
    ["10.00000001", false],
    ["35", false],
  ])("takes a rate of %s: %s", (annual_rate, valid) => {
    expect(
      holdingSchema.safeParse({
        ...base,
        asset_class: "fixed_term",
        amount: "1",
        currency: "ARS",
        annual_rate,
        started_on: "2026-10-01",
        matures_on: "2026-10-31",
      }).success,
    ).toBe(valid);
  });

  it("bounds a rate like the holdings_annual_rate CHECK", () => {
    expect(lastConstraint("holdings", "holdings_annual_rate")).toBe(
      `annual_rate >= 0 AND annual_rate <= ${MAX_ANNUAL_RATE} AND annual_rate <> 'NaN'`,
    );
  });

  // Each class-dependent column with a value it takes when the class has it.
  const CLASS_COLUMNS = {
    instrument_symbol: "BTC",
    currency: "USD",
    annual_rate: "0.35",
    started_on: "2026-10-01",
    matures_on: "2026-10-31",
    valued_on: "2026-10-01",
    label: "Depto",
  };
  const check = lastConstraint("holdings", "holdings_class_fields");
  const branches = Object.fromEntries(
    [...check.matchAll(/asset_class = '(\w+)'([\s\S]*?)\)(?=\s*(OR|$))/g)].map(
      ([, assetClass, branch]) => [assetClass, branch!],
    ),
  );

  it("reads one CHECK branch per class", () => {
    expect(Object.keys(branches).sort()).toEqual([
      "cash",
      "fixed_term",
      "instrument",
      "other",
      "real_estate",
    ]);
  });

  // Read both ways against the CHECK as last written: each class's required
  // and empty columns are the schema's.
  it.each(holdingSchema.options.map((option) => [option] as const))(
    "matches the CHECK for a class",
    (option) => {
      const shape = option.shape as Record<
        string,
        { safeParse: (x: unknown) => { success: boolean } }
      >;
      const assetClass = (shape.asset_class as unknown as { value: string })
        .value;
      const branch = branches[assetClass]!;
      for (const [column, sample] of Object.entries(CLASS_COLUMNS)) {
        const takesNull = shape[column]!.safeParse(null).success;
        const takesText = shape[column]!.safeParse(sample).success;
        if (!takesNull) expect(branch).toContain(`${column} IS NOT NULL`);
        else if (!takesText) expect(branch).toContain(`${column} IS NULL`);
        else expect(branch).not.toContain(`${column} IS`);
      }
    },
  );
});

describe("instrumentValue", () => {
  it("prices one unit of a held instrument in any unit", () => {
    const value = instrumentValue("ETH", "ars", SNAPSHOT, "mep");
    if ("missing" in value) throw new Error(value.missing);
    expect(toDecimal(value.value.amount, 2)).toBe("3000000");
    expect(value.asOf).toBe("2026-10-09");
  });

  // 2500 × 1250: pesos at the user's reference dollar.
  it("prices a unit in pesos at the reference dollar", () => {
    const value = instrumentValue("ETH", "ars", SNAPSHOT, "ccl");
    if ("missing" in value) throw new Error(value.missing);
    expect(toDecimal(value.value.amount, 2)).toBe("3125000");
  });

  it("dates a unit that needs no rate by its price", () => {
    const value = instrumentValue(
      "ETH",
      "usd_mep",
      {
        ...SNAPSHOT,
        prices: {
          ETH: { price: "2500", currency: "USD", date: "2026-10-11" },
        },
      },
      "mep",
    );
    if ("missing" in value) throw new Error(value.missing);
    expect(toDecimal(value.value.amount, 2)).toBe("2500");
    expect(value.asOf).toBe("2026-10-11");
  });
});
