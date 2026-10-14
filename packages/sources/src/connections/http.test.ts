import { balanceRow, call } from "./http";

it("fails as unavailable without the network error, which may name the request", async () => {
  const get = jest
    .fn()
    .mockRejectedValue(
      new TypeError("fetch failed: https://x.test/?token=SECRET_TOKEN"),
    );
  const failed = await call(get, "https://x.test/", {}, 1000).catch(
    (error: unknown) => error,
  );
  expect(failed).toMatchObject({ code: "extraction_failed", retryable: true });
  expect((failed as Error).cause).toBeUndefined();
});

it("rounds a figure given as a string to eight decimals, as it does a number", () => {
  expect(balanceRow("ETH", ["0.123456789"])).toMatchObject({
    symbol: "ETH",
    quantity: "0.12345679",
  });
  expect(balanceRow("SOL", ["0.000000000"])).toBe("empty");
});

it("leaves out any fiat Plant does not keep, and keeps pesos and dollars", () => {
  for (const code of ["TRY", "GBP", "JPY", "PLN", "eur"]) {
    expect(balanceRow(code, ["1000"])).toBeNull();
  }
  expect(balanceRow("ARS", ["1000"])).toMatchObject({ assetClass: "cash" });
  expect(balanceRow("USD", ["1000"])).toMatchObject({ assetClass: "cash" });
  expect(balanceRow("MNT", ["1000"])).toMatchObject({ symbol: "MNT" });
});

it.each(["SCR", "ERN", "RON", "TOP", "SOS"])(
  "keeps %s, an ISO 4217 code exchanges list as a token",
  (code) => {
    expect(balanceRow(code, ["12.5"])).toMatchObject({
      symbol: code,
      quantity: "12.5",
    });
  },
);
