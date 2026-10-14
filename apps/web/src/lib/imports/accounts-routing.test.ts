import { accountFor, routeRows } from "./accounts-routing";
import type { ImportRow } from "./review";

const ACCOUNTS = [
  { id: "a1", institution: "Binance" },
  { id: "a2", institution: "Nexo" },
  { id: "a3", institution: "Banco Galicia" },
];

it("names the user's account by its institution, case and accents aside", () => {
  expect(accountFor("NEXO", ACCOUNTS)).toBe("a2");
  expect(accountFor("Galicia", ACCOUNTS)).toBe("a3");
  expect(accountFor("BingX", ACCOUNTS)).toBeUndefined();
});

it("names none when several accounts would do", () => {
  expect(
    accountFor("Banco", [
      ...ACCOUNTS,
      { id: "a4", institution: "Banco Macro" },
    ]),
  ).toBeUndefined();
});

it("routes each row its label names and leaves the rest for the user", () => {
  const row = (id: string, accountLabel?: string): ImportRow => ({
    id,
    symbol: "BTC",
    quantity: "1",
    price: null,
    currency: "USD",
    confidence: "high",
    source: "Página 1",
    discarded: false,
    ...(accountLabel && { accountLabel }),
  });
  expect(
    routeRows([row("x", "Nexo"), row("y", "BingX"), row("z")], ACCOUNTS).map(
      (each) => [each.id, each.accountId],
    ),
  ).toEqual([
    ["x", "a2"],
    ["y", undefined],
    ["z", undefined],
  ]);
});
