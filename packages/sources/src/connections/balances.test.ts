import { SourceError } from "../file-upload/draft";
import type { HoldingsReading, OperationsReading } from "../port";
import { binanceConnection } from "./binance";
import {
  type FakeProvider,
  startFakeProvider,
} from "./fake-provider.test-support";
import {
  BINANCE_CREDENTIALS,
  IBKR_CREDENTIALS,
  IBKR_STATEMENT,
  IOL_CREDENTIALS,
  MERCADO_PAGO_CREDENTIALS,
  NEXO_CREDENTIALS,
  NOW,
  PROVIDER_FIXTURES,
  resetMercadoPagoReports,
  WALLBIT_CREDENTIALS,
} from "./fixtures.test-support";
import { bodyText, jsonOf } from "./http";
import { ibkrConnection } from "./ibkr";
import { iolConnection } from "./iol";
import { mercadoPagoConnection } from "./mercadopago";
import { nexoConnection } from "./nexo";
import { wallbitConnection } from "./wallbit";

// What each adapter makes of balances: cash, held fiat Plant does not keep,
// balances below zero, and bodies past their cap.

let fake: FakeProvider;
beforeAll(async () => {
  fake = await startFakeProvider();
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests = [];
});

const deps = () => ({
  baseUrl: fake.url,
  now: () => NOW,
  timeoutMs: 2000,
  sleep: async () => undefined,
});
const holdings = (reading: unknown) => reading as HoldingsReading;
const rowsOf = (reading: unknown) =>
  holdings(reading).draft.rows.map((row) => [
    row.symbol,
    row.quantity,
    row.currency,
    row.assetClass ?? "instrument",
  ]);
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SourceError);
  return {
    code: (error as SourceError).code,
    retryable: (error as SourceError).retryable,
  };
};

const WALLBIT_TRADE = {
  uuid: "550e8400-e29b-41d4-a716-446655440001",
  type: "TRADE",
  source_currency: { code: "USD" },
  dest_currency: { code: "AAPL" },
  source_amount: 100,
  dest_amount: 0.5,
  status: "COMPLETED",
  created_at: "2026-10-01T14:30:00.000000Z",
};

describe("cash rows", () => {
  it("marks Wallbit's pesos and dollars as cash and keeps stablecoins as their own crypto", async () => {
    fake.answer = (request) =>
      request.path === "/api/public/v1/balance/checking"
        ? {
            status: 200,
            body: {
              data: [
                { currency: "USD", balance: 1000.5 },
                { currency: "USDC", balance: 40 },
                { currency: "USDT", balance: 2.5 },
                { currency: "ARS", balance: 25000 },
              ],
            },
          }
        : PROVIDER_FIXTURES.wallbit.ok(request);
    const reading = await wallbitConnection(deps()).read(
      WALLBIT_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["AAPL", "10.5", "USD", "instrument"],
      ["ARS", "25000", "ARS", "cash"],
      ["TSLA", "5.25", "USD", "instrument"],
      ["USD", "1500.5", "USD", "cash"],
      ["USDC", "40", "USD", "instrument"],
      ["USDT", "2.5", "USD", "instrument"],
    ]);
  });

  it("marks IBKR's, IOL's and Mercado Pago's cash as cash", async () => {
    fake.answer = PROVIDER_FIXTURES.ibkr.ok;
    expect(
      rowsOf(await ibkrConnection(deps()).read(IBKR_CREDENTIALS, "holdings")),
    ).toContainEqual(["USD", "812.4", "USD", "cash"]);
    fake.answer = PROVIDER_FIXTURES.iol.ok;
    expect(
      rowsOf(await iolConnection(deps()).read(IOL_CREDENTIALS, "holdings")),
    ).toEqual([
      ["AAPL", "20", "ARS", "instrument"],
      ["AL30", "1500", "ARS", "instrument"],
      ["ARS", "125000.5", "ARS", "cash"],
      ["USD", "300", "USD", "cash"],
    ]);
    resetMercadoPagoReports();
    fake.answer = PROVIDER_FIXTURES.mercadopago.ok;
    expect(
      rowsOf(
        await mercadoPagoConnection(deps()).read(
          MERCADO_PAGO_CREDENTIALS,
          "holdings",
        ),
      ),
    ).toEqual([["ARS", "200000.5", "ARS", "cash"]]);
  });
});

describe("wallbit's stocks", () => {
  it("reads a ticker that is also a currency's code as a stock", async () => {
    fake.answer = (request) =>
      request.path === "/api/public/v1/balance/stocks"
        ? {
            status: 200,
            body: {
              data: [
                { symbol: "COP", shares: 3 },
                { symbol: "PEN", shares: 2 },
                { symbol: "CRC", shares: 1 },
              ],
            },
          }
        : request.path === "/api/public/v1/balance/checking"
          ? { status: 200, body: { data: [{ currency: "USD", balance: 10 }] } }
          : PROVIDER_FIXTURES.wallbit.ok(request);
    const reading = await wallbitConnection(deps()).read(
      WALLBIT_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["COP", "3", "USD", "instrument"],
      ["CRC", "1", "USD", "instrument"],
      ["PEN", "2", "USD", "instrument"],
      ["USD", "10", "USD", "cash"],
    ]);
    expect(holdings(reading).read.skippedRows).toBe(0);
  });
});

describe("cash in several accounts of one currency", () => {
  it("adds up IOL's accounts in dollars into one cash row", async () => {
    fake.answer = (request) =>
      request.path === "/api/v2/estadocuenta"
        ? {
            status: 200,
            body: {
              cuentas: [
                { moneda: "dolar_Estadounidense", saldo: 100 },
                { moneda: "dolar_Estadounidense", saldo: 50 },
              ],
            },
          }
        : PROVIDER_FIXTURES.iol.ok(request);
    const reading = await iolConnection(deps()).read(
      IOL_CREDENTIALS,
      "holdings",
    );
    expect(
      rowsOf(reading).filter(([, , , assetClass]) => assetClass === "cash"),
    ).toEqual([["USD", "150", "USD", "cash"]]);
  });

  it("adds up IBKR's cash reports in dollars into one cash row", async () => {
    const statement = IBKR_STATEMENT.replace(
      '<CashReportCurrency currency="USD" endingCash="812.4" />',
      '<CashReportCurrency currency="USD" endingCash="812.4" />' +
        '<CashReportCurrency currency="USD" endingCash="0.6" />',
    );
    fake.answer = (request) =>
      request.path.endsWith("/GetStatement")
        ? { status: 200, type: "xml", body: statement }
        : PROVIDER_FIXTURES.ibkr.ok(request);
    const reading = await ibkrConnection(deps()).read(
      IBKR_CREDENTIALS,
      "holdings",
    );
    expect(
      rowsOf(reading).filter(([, , , assetClass]) => assetClass === "cash"),
    ).toEqual([["USD", "813", "USD", "cash"]]);
  });
});

describe("binance's balances", () => {
  it("reads pesos as cash and leaves out, counted, a fiat Plant does not keep", async () => {
    fake.answer = (request) =>
      request.path === "/api/v3/account"
        ? {
            status: 200,
            body: {
              balances: [
                { asset: "ARS", free: "1000", locked: "0" },
                { asset: "EUR", free: "50", locked: "0" },
                { asset: "BTC", free: "0.5", locked: "0" },
              ],
            },
          }
        : PROVIDER_FIXTURES.binance.ok(request);
    const reading = await binanceConnection(deps()).read(
      BINANCE_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["ARS", "1000", "ARS", "cash"],
      ["BTC", "0.5", "USD", "instrument"],
    ]);
    expect(holdings(reading).read.skippedRows).toBe(1);
  });
});

describe("balances a draft cannot hold", () => {
  it("counts IBKR's negative cash and cash in a currency Plant does not keep", async () => {
    const statement = IBKR_STATEMENT.replace(
      '<CashReportCurrency currency="USD" endingCash="812.4" />',
      '<CashReportCurrency currency="USD" endingCash="-120.5" />' +
        '<CashReportCurrency currency="EUR" endingCash="40" />' +
        '<CashReportCurrency currency="ARS" endingCash="0" />',
    );
    fake.answer = (request) =>
      request.path.endsWith("/GetStatement")
        ? { status: 200, type: "xml", body: statement }
        : PROVIDER_FIXTURES.ibkr.ok(request);
    const reading = holdings(
      await ibkrConnection(deps()).read(IBKR_CREDENTIALS, "holdings"),
    );
    expect(reading.draft.rows.map((row) => row.symbol)).toEqual([
      "AAPL",
      "SPY",
    ]);
    // The euro position, the negative dollars and the euros.
    expect(reading.read.skippedRows).toBe(3);
  });

  it("counts IOL's negative cash and cash in a currency Plant does not keep", async () => {
    fake.answer = (request) =>
      request.path === "/api/v2/estadocuenta"
        ? {
            status: 200,
            body: {
              cuentas: [
                { moneda: "peso_Argentino", saldo: -500 },
                { moneda: "euro", saldo: 20 },
                { moneda: "dolar_Estadounidense", saldo: 0 },
              ],
            },
          }
        : PROVIDER_FIXTURES.iol.ok(request);
    const reading = holdings(
      await iolConnection(deps()).read(IOL_CREDENTIALS, "holdings"),
    );
    expect(reading.draft.rows.map((row) => row.symbol)).toEqual([
      "AAPL",
      "AL30",
    ]);
    expect(reading.read.skippedRows).toBe(2);
  });

  it("counts Nexo's negative balances and a fiat Plant does not keep, and reads pesos as cash", async () => {
    fake.answer = (request) =>
      request.path === "/accountSummary"
        ? {
            status: 200,
            body: {
              balances: [
                { assetName: "BTC", totalBalance: 0.05 },
                { assetName: "ETH", totalBalance: -0.2 },
                { assetName: "EUR", totalBalance: 10 },
                { assetName: "ARS", totalBalance: 1000 },
                { assetName: "SOL", totalBalance: 0 },
              ],
            },
          }
        : PROVIDER_FIXTURES.nexo.ok(request);
    const reading = await nexoConnection(deps()).read(
      NEXO_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["ARS", "1000", "ARS", "cash"],
      ["BTC", "0.05", "USD", "instrument"],
    ]);
    expect(holdings(reading).read.skippedRows).toBe(2);
  });
});

describe("wallbit's transactions", () => {
  it("counts the trades on the pages past the ones a sync reads", async () => {
    fake.answer = (request) =>
      request.path === "/api/public/v1/transactions"
        ? {
            status: 200,
            body: {
              data: {
                data: request.query.get("page") === "1" ? [WALLBIT_TRADE] : [],
                pages: 12,
                count: 551,
              },
            },
          }
        : PROVIDER_FIXTURES.wallbit.ok(request);
    const reading = (await wallbitConnection(deps()).read(
      WALLBIT_CREDENTIALS,
      "operations",
    )) as OperationsReading;
    expect(reading.operations).toHaveLength(1);
    // Pages 11 and 12 are never read: 551 trades less the 500 the first ten
    // hold.
    expect(reading.read.skippedRows).toBe(51);
    expect(
      fake.requests.filter((each) => each.path.endsWith("/transactions")),
    ).toHaveLength(10);
  });
});

describe("a provider's body", () => {
  const streaming = (chunks: number, headers: Record<string, string> = {}) => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > chunks) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(65));
      },
    });
    return { response: new Response(body, { headers }), pulled: () => pulled };
  };

  it("refuses for good a body that says it is larger than the cap, without reading it", async () => {
    const { response, pulled } = streaming(10, { "content-length": "4096" });
    expect(await failure(bodyText(response, 2048))).toEqual({
      code: "extraction_failed",
      retryable: false,
    });
    expect(pulled()).toBeLessThanOrEqual(1);
  });

  it("stops reading a body that streams past the cap", async () => {
    const { response, pulled } = streaming(1_000_000);
    expect(await failure(bodyText(response, 8 * 1024))).toEqual({
      code: "extraction_failed",
      retryable: false,
    });
    expect(pulled()).toBeLessThan(20);
  });

  it("reads a body within the cap, and JSON that does not parse as null", async () => {
    expect(await bodyText(new Response("hola"), 10)).toBe("hola");
    expect(await jsonOf(new Response("{nope"))).toBeNull();
    expect(await jsonOf(new Response('{"a":1}'))).toEqual({ a: 1 });
  });

  it("refuses for good a JSON answer past its cap", async () => {
    const { response } = streaming(1_000_000);
    expect(await failure(jsonOf(response))).toEqual({
      code: "extraction_failed",
      retryable: false,
    });
  });
});
