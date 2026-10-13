import type { QuoteRange, StoredQuotes } from "./contract/port";
import {
  QUOTES_ON_CONCURRENCY,
  readQuotesOn,
  readSnapshot,
  snapshotFromRows,
  snapshotOn,
} from "./snapshot";

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

describe("readQuotesOn", () => {
  const need = { fxKinds: ["mep" as const], symbols: ["BTC"] };

  it("shares one read between days whose weeks overlap", async () => {
    const read = jest.fn().mockResolvedValue(rows({}));
    await readQuotesOn(
      { read },
      ["2026-10-10", "2026-10-05", "2026-09-30", "2026-10-10"],
      need,
    );
    expect(read.mock.calls).toEqual([
      [{ from: "2026-09-23", to: "2026-10-10", ...need }],
    ]);
  });

  it("reads days a month apart on their own", async () => {
    const read = jest.fn().mockResolvedValue(rows({}));
    await readQuotesOn({ read }, ["2026-08-31", "2026-09-30"], need);
    expect(read.mock.calls).toEqual([
      [{ from: "2026-08-24", to: "2026-08-31", ...need }],
      [{ from: "2026-09-23", to: "2026-09-30", ...need }],
    ]);
  });

  it("starts a new read past the longest span", async () => {
    const read = jest.fn().mockResolvedValue(rows({}));
    const days = Array.from(
      { length: 31 },
      (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`,
    );
    await readQuotesOn({ read }, [...days, "2026-09-01", "2026-09-05"], need);
    expect(read.mock.calls.map(([range]) => [range.from, range.to])).toEqual([
      ["2026-07-25", "2026-08-24"],
      ["2026-08-18", "2026-09-05"],
    ]);
  });

  it("returns every read's rows, each day's snapshot as a read of it", async () => {
    const stored = rows({
      fxRates: [fx("2026-08-30", "1100"), fx("2026-09-29", "1150")],
      prices: [price("BTC", "2026-09-28", "61000")],
    });
    const read = jest.fn().mockResolvedValue(stored);
    const all = await readQuotesOn(
      { read },
      ["2026-08-31", "2026-09-30"],
      need,
    );
    for (const day of ["2026-08-31", "2026-09-30"]) {
      expect(snapshotOn(all, day, need)).toEqual(
        await readSnapshot({ read }, day, need),
      );
    }
  });

  it("runs a bounded number of reads at once", async () => {
    let running = 0;
    let most = 0;
    const read = jest.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      return rows({});
    });
    const months = Array.from(
      { length: 12 },
      (_, index) => `2025-${String(index + 1).padStart(2, "0")}-28`,
    );
    await readQuotesOn({ read }, months, need);
    expect(read).toHaveBeenCalledTimes(12);
    expect(most).toBe(QUOTES_ON_CONCURRENCY);
  });

  it("reads nothing for no days", async () => {
    const read = jest.fn();
    expect(await readQuotesOn({ read }, [], need)).toEqual(rows({}));
    expect(read).not.toHaveBeenCalled();
  });
});
