import { SourceError } from "../file-upload/draft";
import type { HoldingsReading, OperationsReading } from "../port";
import {
  type FakeProvider,
  startFakeProvider,
} from "./fake-provider.test-support";
import { bitsoConnection } from "./bitso";
import {
  BITSO_CREDENTIALS,
  IBKR_CREDENTIALS,
  IOL_CREDENTIALS,
  MERCADO_PAGO_CREDENTIALS,
  NEXO_CREDENTIALS,
  NOW,
  PROVIDER_FIXTURES,
  resetMercadoPagoReports,
  RIPIO_CREDENTIALS,
  ROXOM_CREDENTIALS,
  WALLBIT_CREDENTIALS,
} from "./fixtures.test-support";
import { ibkrConnection } from "./ibkr";
import { iolConnection } from "./iol";
import { balanceOf, mercadoPagoConnection } from "./mercadopago";
import { nexoConnection } from "./nexo";
import { ripioConnection } from "./ripio";
import { roxomConnection } from "./roxom";
import { wallbitConnection } from "./wallbit";

// What each adapter makes of its provider's answers, past the contract.

let fake: FakeProvider;
beforeAll(async () => {
  fake = await startFakeProvider();
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests = [];
});

const deps = () => ({ baseUrl: fake.url, now: () => NOW, timeoutMs: 2000 });
const rowsOf = (reading: unknown) =>
  (reading as HoldingsReading).draft.rows.map((row) => [
    row.symbol,
    row.quantity,
    row.currency,
  ]);
const operationsOf = (reading: unknown) =>
  (reading as OperationsReading).operations;
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

describe("wallbit", () => {
  beforeEach(() => {
    fake.answer = PROVIDER_FIXTURES.wallbit.ok;
  });

  it("adds up the dollars of both accounts and leaves out currencies Plant does not keep", async () => {
    const reading = await wallbitConnection(deps()).read(
      WALLBIT_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["AAPL", "10.5", "USD"],
      ["ARS", "25000", "ARS"],
      ["TSLA", "5.25", "USD"],
      ["USD", "1500.5", "USD"],
    ]);
    expect((reading as HoldingsReading).read.skippedRows).toBe(1);
  });

  it("reads trades as purchases and sales, newest first, and skips a currency exchange", async () => {
    const reading = await wallbitConnection(deps()).read(
      WALLBIT_CREDENTIALS,
      "operations",
    );
    expect(
      operationsOf(reading).map((each) => [
        each.date,
        each.kind,
        each.symbol,
        each.quantity,
        each.amount,
      ]),
    ).toEqual([
      ["2026-10-05", "sale", "TSLA", "1.5", "420.25"],
      ["2026-10-01", "purchase", "AAPL", "0.5847953", "100"],
    ]);
    expect(fake.requests.at(-1)!.query.get("type")).toBe("TRADE");
  });

  it("refuses a key Wallbit says holds the trade permission", async () => {
    fake.answer = () => ({
      status: 403,
      body: {
        message: "Insufficient permissions. Required permission: read",
        your_permissions: ["trade"],
      },
    });
    expect(
      await failure(wallbitConnection(deps()).check(WALLBIT_CREDENTIALS)),
    ).toEqual({ code: "connection_not_read_only", retryable: false });
  });
});

describe("ibkr", () => {
  beforeEach(() => {
    fake.answer = PROVIDER_FIXTURES.ibkr.ok;
  });

  it("reads the summary of each position and the cash, dated as the statement", async () => {
    const sleep = jest.fn(async () => undefined);
    const reading = (await ibkrConnection({ ...deps(), sleep }).read(
      IBKR_CREDENTIALS,
      "holdings",
    )) as HoldingsReading;
    expect(rowsOf(reading)).toEqual([
      ["AAPL", "10", "USD"],
      ["SPY", "2.5", "USD"],
      ["USD", "812.4", "USD"],
    ]);
    expect(reading.draft.rows[0]).toMatchObject({
      price: "230.5",
      value: "2305",
      cost: "180.25",
    });
    expect(reading.draft.documentDate).toBe("2026-10-13");
    // A euro position is skipped.
    expect(reading.read.skippedRows).toBe(1);
    // It waited once while the statement was generated.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fake.requests.map((each) => each.path.split("/").at(-1))).toEqual([
      "SendRequest",
      "GetStatement",
      "GetStatement",
    ]);
    expect(fake.requests[1]!.query.get("q")).toBe("5550001");
  });

  it("reads each execution and dividend as an operation", async () => {
    const reading = await ibkrConnection({
      ...deps(),
      sleep: async () => undefined,
    }).read(IBKR_CREDENTIALS, "operations");
    expect(
      operationsOf(reading).map((each) => [
        each.date,
        each.kind,
        each.symbol,
        each.quantity,
        each.price,
        each.amount,
        each.charges,
      ]),
    ).toEqual([
      ["2026-10-02", "sale", "MSFT", "4", "410", "1640", "1.2"],
      ["2026-09-30", "dividend", "SPY", null, null, "3.21", null],
      ["2026-09-15", "purchase", "AAPL", "10", "175.5", "1755", "1"],
    ]);
  });

  it("refuses a query the token does not run, and gives up for now on a statement never generated", async () => {
    fake.answer = () => ({
      status: 200,
      type: "xml",
      body: "<FlexStatementResponse><Status>Fail</Status><ErrorCode>1014</ErrorCode></FlexStatementResponse>",
    });
    expect(
      await failure(ibkrConnection(deps()).check(IBKR_CREDENTIALS)),
    ).toEqual({ code: "connection_rejected", retryable: false });

    fake.answer = (request) => ({
      status: 200,
      type: "xml",
      body: request.path.endsWith("/SendRequest")
        ? "<FlexStatementResponse><Status>Success</Status><ReferenceCode>1</ReferenceCode></FlexStatementResponse>"
        : "<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode></FlexStatementResponse>",
    });
    const sleep = jest.fn(async () => undefined);
    expect(
      await failure(
        ibkrConnection({ ...deps(), sleep }).read(IBKR_CREDENTIALS, "holdings"),
      ),
    ).toEqual({ code: "extraction_failed", retryable: true });
    expect(sleep.mock.calls.length).toBeGreaterThan(3);
  });
});

describe("ibkr's budget", () => {
  it("stops waiting for a statement before the read's budget runs out", async () => {
    fake.answer = (request) => ({
      status: 200,
      type: "xml",
      body: request.path.endsWith("/SendRequest")
        ? "<FlexStatementResponse><Status>Success</Status><ReferenceCode>1</ReferenceCode></FlexStatementResponse>"
        : "<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode></FlexStatementResponse>",
    });
    let now = 0;
    const sleep = jest.fn(async (ms: number) => {
      now += ms;
    });
    const port = ibkrConnection({
      ...deps(),
      sleep,
      clock: () => now,
      budgetMs: 10_000,
    });
    expect(await failure(port.read(IBKR_CREDENTIALS, "holdings"))).toEqual({
      code: "extraction_failed",
      retryable: true,
    });
    // 2 s and 3 s fit in 10 s; the next 5 s would leave nothing to ask with.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 3000]);
    expect(now).toBeLessThan(10_000);
  });
});

describe("nexo", () => {
  it("reads each balance held, signing the request with the time as its nonce", async () => {
    fake.answer = PROVIDER_FIXTURES.nexo.ok;
    const reading = await nexoConnection(deps()).read(
      NEXO_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["BTC", "0.05", "USD"],
      ["USDT", "1200.75", "USD"],
    ]);
    expect(fake.requests[0]!.headers["x-nonce"]).toBe(String(NOW.getTime()));
  });
});

describe("iol", () => {
  it("logs in with the form IOL takes, then reads the portfolio and each account's cash", async () => {
    fake.answer = PROVIDER_FIXTURES.iol.ok;
    const reading = (await iolConnection(deps()).read(
      IOL_CREDENTIALS,
      "holdings",
    )) as HoldingsReading;
    expect(rowsOf(reading)).toEqual([
      ["AAPL", "20", "ARS"],
      ["AL30", "1500", "ARS"],
      ["ARS", "125000.5", "ARS"],
      ["USD", "300", "USD"],
    ]);
    expect(
      reading.draft.rows.find((row) => row.symbol === "AL30"),
    ).toMatchObject({ price: "73.4", value: "110100", cost: "65.1" });
    const [login, ...reads] = fake.requests;
    expect(login).toMatchObject({ method: "POST", path: "/token" });
    expect(login!.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(reads.map((each) => [each.method, each.path])).toEqual([
      ["GET", "/api/v2/portafolio/argentina"],
      ["GET", "/api/v2/estadocuenta"],
    ]);
  });
});

describe("roxom", () => {
  beforeEach(() => {
    fake.answer = PROVIDER_FIXTURES.roxom.ok;
  });

  it("reads each balance in bitcoin, signing the method and the path with its query", async () => {
    const reading = await roxomConnection(deps()).read(
      ROXOM_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["BTC", "0.125", "USD"],
      ["USDT", "350", "USD"],
    ]);
    expect(fake.requests.map((each) => each.url)).toEqual([
      "/v1/accounts/balance?unit=btc",
    ]);
  });

  it("takes a private key whose line breaks a form dropped", async () => {
    const oneLine = ROXOM_CREDENTIALS.privateKey.replace(/\r?\n/g, "");
    await expect(
      roxomConnection(deps()).check({
        ...ROXOM_CREDENTIALS,
        privateKey: oneLine,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a PEM that holds no private key without asking Roxom", async () => {
    const port = roxomConnection(deps());
    const notAKey = `-----BEGIN PRIVATE KEY-----${"A".repeat(200)}-----END PRIVATE KEY-----`;
    expect(
      port.parse({ ...ROXOM_CREDENTIALS, privateKey: "not a pem" }),
    ).toBeNull();
    expect(
      await failure(port.check({ ...ROXOM_CREDENTIALS, privateKey: notAKey })),
    ).toEqual({ code: "connection_rejected", retryable: false });
    expect(fake.requests).toEqual([]);
  });
});

describe("mercado pago", () => {
  beforeEach(() => {
    resetMercadoPagoReports();
    fake.answer = PROVIDER_FIXTURES.mercadopago.ok;
  });

  it("asks for the week's report, waits while it is generated, and reads the balance it closes with", async () => {
    const sleep = jest.fn(async () => undefined);
    const reading = (await mercadoPagoConnection({ ...deps(), sleep }).read(
      MERCADO_PAGO_CREDENTIALS,
      "holdings",
    )) as HoldingsReading;
    expect(rowsOf(reading)).toEqual([["ARS", "200000.5", "ARS"]]);
    expect(reading.draft.rows[0]!.confidence).toBe("medium");
    expect(reading.draft.documentDate).toBe("2026-10-14");
    expect(fake.requests.map((each) => [each.method, each.path])).toEqual([
      ["GET", "/v1/account/release_report/list"],
      ["POST", "/v1/account/release_report"],
      ["GET", "/v1/account/release_report/list"],
      ["GET", "/v1/account/release_report/list"],
      [
        "GET",
        "/v1/account/release_report/release-report-123456789-2026-10-14-150000.csv",
      ],
    ]);
    expect(JSON.parse(fake.requests[1]!.body)).toEqual({
      begin_date: "2026-10-07T15:00:00Z",
      end_date: "2026-10-14T15:00:00Z",
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("downloads the report a read within the same hour asked for already", async () => {
    const port = mercadoPagoConnection({
      ...deps(),
      sleep: async () => undefined,
    });
    await port.read(MERCADO_PAGO_CREDENTIALS, "holdings");
    fake.requests = [];
    await port.read(MERCADO_PAGO_CREDENTIALS, "holdings");
    expect(fake.requests.map((each) => each.method)).toEqual(["GET", "GET"]);
  });

  it("stops waiting for a report before the read's budget runs out", async () => {
    fake.answer = (request) =>
      request.method === "POST"
        ? { status: 202, body: {} }
        : request.path.endsWith("/list")
          ? { status: 200, body: [] }
          : PROVIDER_FIXTURES.mercadopago.ok(request);
    let now = 0;
    const sleep = jest.fn(async (ms: number) => {
      now += ms;
    });
    const port = mercadoPagoConnection({
      ...deps(),
      sleep,
      clock: () => now,
      budgetMs: 10_000,
    });
    expect(
      await failure(port.read(MERCADO_PAGO_CREDENTIALS, "holdings")),
    ).toEqual({ code: "extraction_failed", retryable: true });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 3000]);
  });

  it("reads a report separated by semicolons the es-AR way, and only pesos", () => {
    expect(
      balanceOf(
        "﻿DATE;RECORD_TYPE;BALANCE_AMOUNT;CURRENCY\r\n2026-10-01;release;1500,25;ARS\r\n2026-10-02;release;1.234.567,89;ARS\r\n2026-10-03;release;99,00;USD\r\n",
      ),
    ).toBe("1234567.89");
    expect(balanceOf("DATE,RECORD_TYPE\n2026-10-01,release\n")).toBeNull();
  });

  it("never reads a comma as a decimal mark in a report separated by commas", () => {
    expect(
      balanceOf(
        'DATE,BALANCE_AMOUNT,CURRENCY\n2026-10-01,900.50,ARS\n2026-10-02,"1,500",ARS\n',
      ),
    ).toBeNull();
  });

  it("has no balance when the last one does not read, never an earlier line's", () => {
    expect(
      balanceOf(
        'DATE,BALANCE_AMOUNT,CURRENCY\n2026-10-01,900.50,ARS\n2026-10-02,"1.234,56",ARS\n',
      ),
    ).toBeNull();
    expect(
      balanceOf(
        "DATE;BALANCE_AMOUNT;CURRENCY\n2026-10-01;900,50;ARS\n2026-10-02;12.34.5,6;ARS\n",
      ),
    ).toBeNull();
  });

  it("keeps a line break inside quotes in its field", () => {
    expect(
      balanceOf(
        'DATE,DESCRIPTION,BALANCE_AMOUNT,CURRENCY\n2026-10-01,"Pago\nen dos líneas",700.25,ARS\n',
      ),
    ).toBe("700.25");
  });

  it("counts a zero balance as left out, so the draft is not silently empty", async () => {
    fake.answer = (request) =>
      request.path.endsWith(".csv")
        ? {
            status: 200,
            type: "text",
            body: "DATE,BALANCE_AMOUNT,CURRENCY\n2026-10-14,0.00,ARS\n",
          }
        : PROVIDER_FIXTURES.mercadopago.ok(request);
    const reading = (await mercadoPagoConnection({
      ...deps(),
      sleep: async () => undefined,
    }).read(MERCADO_PAGO_CREDENTIALS, "holdings")) as HoldingsReading;
    expect(reading.draft.rows).toEqual([]);
    expect(reading.read.skippedRows).toBe(1);
  });

  it("counts nothing left out when only an earlier line's balance does not read", async () => {
    fake.answer = (request) =>
      request.path.endsWith(".csv")
        ? {
            status: 200,
            type: "text",
            body: "DATE,BALANCE_AMOUNT,CURRENCY\n2026-10-13,abc,ARS\n2026-10-14,700.25,ARS\n",
          }
        : PROVIDER_FIXTURES.mercadopago.ok(request);
    const reading = (await mercadoPagoConnection({
      ...deps(),
      sleep: async () => undefined,
    }).read(MERCADO_PAGO_CREDENTIALS, "holdings")) as HoldingsReading;
    expect(rowsOf(reading)).toEqual([["ARS", "700.25", "ARS"]]);
    expect(reading.read.skippedRows).toBe(0);
  });

  it("waits for a report already asked for instead of asking again", async () => {
    let lists = 0;
    fake.answer = (request) => {
      if (!request.path.endsWith("/list")) {
        return PROVIDER_FIXTURES.mercadopago.ok(request);
      }
      lists += 1;
      return {
        status: 200,
        body: [
          {
            begin_date: "2026-10-07T15:00:00Z",
            end_date: "2026-10-14T15:00:00Z",
            file_name:
              lists < 3
                ? null
                : "release-report-123456789-2026-10-14-150000.csv",
            status: lists < 3 ? "pending" : "processed",
          },
        ],
      };
    };
    await mercadoPagoConnection({
      ...deps(),
      sleep: async () => undefined,
    }).read(MERCADO_PAGO_CREDENTIALS, "holdings");
    expect(fake.requests.map((each) => each.method)).not.toContain("POST");
    expect(lists).toBe(3);
  });

  it("refuses for good a report Mercado Pago lists under a name that is no report file", async () => {
    for (const name of ["..", ".", "../../users/me", "report.txt", "-.csv"]) {
      fake.answer = (request) =>
        request.path.endsWith("/list")
          ? {
              status: 200,
              body: [
                {
                  begin_date: "2026-10-07T15:00:00Z",
                  end_date: "2026-10-14T15:00:00Z",
                  file_name: name,
                  status: "processed",
                },
              ],
            }
          : PROVIDER_FIXTURES.mercadopago.ok(request);
      fake.requests = [];
      expect(
        await failure(
          mercadoPagoConnection(deps()).read(
            MERCADO_PAGO_CREDENTIALS,
            "holdings",
          ),
        ),
      ).toEqual({ code: "extraction_failed", retryable: true });
      expect(fake.requests).toHaveLength(1);
    }
  });

  it("asks the user to set the report up when Mercado Pago has no configuration for it", async () => {
    fake.answer = (request) =>
      request.method === "POST"
        ? {
            status: 404,
            body: { message: "Configuration not found", status: 404 },
          }
        : PROVIDER_FIXTURES.mercadopago.ok(request);
    expect(
      await failure(
        mercadoPagoConnection(deps()).read(
          MERCADO_PAGO_CREDENTIALS,
          "holdings",
        ),
      ),
    ).toEqual({ code: "unsupported", retryable: false });
  });
});

describe("bitso", () => {
  it("reads each currency's total, pesos as cash, and counts a fiat Plant does not keep as left out", async () => {
    fake.answer = PROVIDER_FIXTURES.bitso.ok;
    const reading = (await bitsoConnection(deps()).read(
      BITSO_CREDENTIALS,
      "holdings",
    )) as HoldingsReading;
    expect(rowsOf(reading)).toEqual([
      ["ARS", "52000.75", "ARS"],
      ["BTC", "0.03", "USD"],
    ]);
    expect(reading.read.skippedRows).toBe(1);
    const nonce = String(fake.requests[0]!.headers.authorization).split(":")[1];
    expect(nonce?.startsWith(String(NOW.getTime()))).toBe(true);
  });
});

describe("ripio", () => {
  it("reads what is free and what orders hold of each currency", async () => {
    fake.answer = PROVIDER_FIXTURES.ripio.ok;
    const reading = await ripioConnection(deps()).read(
      RIPIO_CREDENTIALS,
      "holdings",
    );
    expect(rowsOf(reading)).toEqual([
      ["ARS", "150000.5", "ARS"],
      ["BTC", "0.0225", "USD"],
      ["USDC", "80.25", "USD"],
    ]);
    expect(fake.requests[0]!.headers.timestamp).toBe(String(NOW.getTime()));
  });
});
