import type { QuoteRange, StoredQuotes } from "./contract/port";
import { readSnapshot, snapshotFromRows, snapshotOn } from "./snapshot";

const RANGE: QuoteRange = {
  from: "2026-10-03",
  to: "2026-10-10",
  fxKinds: ["mep"],
  symbols: ["BTC", "ETH"],
};

const fx = (rate_date: string, sell: string) => ({
  kind: "mep" as const,
  rate_date,
  sell,
});
const price = (symbol: string, price_date: string, amount: string) => ({
  symbol,
  price_date,
  price: amount,
  currency: "USD" as const,
});

const rows = (partial: Partial<StoredQuotes>): StoredQuotes => ({
  fxRates: [],
  prices: [],
  ...partial,
});

describe("snapshotFromRows", () => {
  it("keeps each key's latest row in any order", () => {
    const { snapshot } = snapshotFromRows(
      RANGE,
      rows({
        fxRates: [
          fx("2026-10-08", "1200"),
          fx("2026-10-09", "1210"),
          fx("2026-10-07", "1190"),
        ],
      }),
    );
    expect(snapshot.fx.mep).toEqual({ sell: "1210", date: "2026-10-09" });
  });

  it("ignores rows outside the range", () => {
    const { snapshot } = snapshotFromRows(
      RANGE,
      rows({
        fxRates: [fx("2026-10-11", "1300"), fx("2026-10-02", "1100")],
      }),
    );
    expect(snapshot.fx.mep).toBeUndefined();
  });

  it("keeps a row on the range's first day", () => {
    const { snapshot } = snapshotFromRows(
      RANGE,
      rows({ fxRates: [fx("2026-10-03", "1100")] }),
    );
    expect(snapshot.fx.mep?.date).toBe("2026-10-03");
  });

  it("drops and counts a row whose amount fails the decimal check", () => {
    const read = snapshotFromRows(
      RANGE,
      rows({
        fxRates: [fx("2026-10-09", "-1"), fx("2026-10-08", "1200")],
        prices: [price("BTC", "2026-10-10", "abc")],
      }),
    );
    expect(read.invalidCount).toBe(2);
    expect(read.snapshot.fx.mep?.sell).toBe("1200");
    expect(read.snapshot.prices.BTC).toBeUndefined();
  });

  it("keeps symbols apart", () => {
    const { snapshot } = snapshotFromRows(
      RANGE,
      rows({
        prices: [
          price("BTC", "2026-10-09", "65000"),
          price("ETH", "2026-10-10", "2500"),
        ],
      }),
    );
    expect(snapshot.prices).toEqual({
      BTC: { price: "65000", currency: "USD", date: "2026-10-09" },
      ETH: { price: "2500", currency: "USD", date: "2026-10-10" },
    });
  });

  it("ignores keys the range does not name", () => {
    const { snapshot } = snapshotFromRows(
      RANGE,
      rows({
        fxRates: [{ kind: "ccl", rate_date: "2026-10-09", sell: "1250" }],
        prices: [price("SOL", "2026-10-09", "150")],
      }),
    );
    expect(snapshot.fx).toEqual({});
    expect(snapshot.prices).toEqual({});
  });
});

describe("readSnapshot", () => {
  it("asks for a week back with sorted, distinct keys", async () => {
    const read = jest.fn().mockResolvedValue(rows({}));
    await readSnapshot({ read }, "2026-10-10", {
      fxKinds: ["official", "mep", "mep"],
      symbols: ["ETH", "BTC", "ETH"],
    });
    expect(read).toHaveBeenCalledWith({
      from: "2026-10-03",
      to: "2026-10-10",
      fxKinds: ["mep", "official"],
      symbols: ["BTC", "ETH"],
    });
  });

  it("treats a row 8 days old as missing and one 7 days old as kept", async () => {
    const read = jest.fn().mockResolvedValue(
      rows({
        fxRates: [fx("2026-10-02", "1100")],
        prices: [price("BTC", "2026-10-03", "60000")],
      }),
    );
    const { snapshot } = await readSnapshot({ read }, "2026-10-10", {
      fxKinds: ["mep"],
      symbols: ["BTC"],
    });
    expect(snapshot.fx.mep).toBeUndefined();
    expect(snapshot.prices.BTC?.date).toBe("2026-10-03");
  });

  it("rejects with what the reader rejects with", async () => {
    const failure = new Error("boom");
    await expect(
      readSnapshot({ read: () => Promise.reject(failure) }, "2026-10-10", {
        fxKinds: [],
        symbols: [],
      }),
    ).rejects.toBe(failure);
  });
});

describe("snapshotOn", () => {
  it("reads a day from rows already read, as readSnapshot would", async () => {
    const stored = rows({
      fxRates: [fx("2026-10-02", "1100"), fx("2026-10-05", "1150")],
      prices: [price("BTC", "2026-10-11", "61000")],
    });
    const need = { fxKinds: ["mep" as const], symbols: ["BTC"] };
    const read = jest.fn().mockResolvedValue(stored);
    expect(snapshotOn(stored, "2026-10-10", need)).toEqual(
      await readSnapshot({ read }, "2026-10-10", need),
    );
    expect(snapshotOn(stored, "2026-10-10", need).snapshot.fx.mep?.sell).toBe(
      "1150",
    );
  });
});
