jest.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));

import type { Listing } from "@plant/core";

import type { InstrumentRow } from "@/lib/holdings/read";

import type { InstrumentMarket } from "./instrument-market";
import { lookUpNames } from "./market-lookup";

const row = (symbol: string, currency: "ARS" | "USD"): InstrumentRow =>
  ({
    symbol,
    name: symbol,
    type: "stock",
    currency,
    aliases: [],
  }) as InstrumentRow;

const GOOGL: Listing = {
  symbol: "GOOGL",
  name: "Alphabet",
  type: "cedear",
  currency: "ARS",
  market: "byma",
  lines: ["GOGLD"],
};

function market(addCodes: Record<string, string> = {}) {
  const calls: string[] = [];
  const port: InstrumentMarket = {
    search: async (query) => {
      calls.push(`search ${query}`);
      return { ok: true, listings: [GOOGL], failed: [] };
    },
    add: async (symbol, from) => {
      calls.push(`add ${symbol} ${from}`);
      const code = addCodes[symbol];
      return code
        ? ({ ok: false, code } as never)
        : {
            ok: true,
            instrument: row(symbol, from === "us" ? "USD" : "ARS"),
          };
    },
  };
  return { port, calls };
}

it("adds a US listing as it is and a dollar line after a search", async () => {
  const { port, calls } = market();
  const found: [string, string, boolean][] = [];
  const left = await lookUpNames(
    ["VOO.US", "GOGLD", "NOPE"],
    ["us", "crypto"],
    port,
    (name, instrument, usd) => found.push([name, instrument.symbol, usd]),
  );
  expect(left).toBe(0);
  expect(calls).toEqual([
    "add VOO.US us",
    "search GOGLD",
    "add GOOGL byma",
    "search NOPE",
  ]);
  expect(found).toEqual([
    ["VOO.US", "VOO.US", false],
    ["GOGLD", "GOOGL", true],
  ]);
});

it("leaves a US listing alone where the account does not trade there", async () => {
  const { port, calls } = market();
  await lookUpNames(["VOO.US"], ["byma"], port, () => undefined);
  expect(calls).toEqual([]);
});

it("stops at a limit and says how many names were left", async () => {
  const { port, calls } = market({ "SPY.US": "limited" });
  const left = await lookUpNames(
    ["VOO.US", "SPY.US", "QQQ.US"],
    ["us"],
    port,
    () => undefined,
  );
  expect(left).toBe(2);
  expect(calls).toEqual(["add VOO.US us", "add SPY.US us"]);
});

it("goes on past a name the market does not list", async () => {
  const { port, calls } = market({ "GONE.US": "not_listed" });
  const left = await lookUpNames(
    ["GONE.US", "VOO.US"],
    ["us"],
    port,
    () => undefined,
  );
  expect(left).toBe(0);
  expect(calls).toEqual(["add GONE.US us", "add VOO.US us"]);
});
