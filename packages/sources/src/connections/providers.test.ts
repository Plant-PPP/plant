import { SourceError } from "../file-upload/draft";
import type { HoldingsReading, OperationsReading } from "../port";
import {
  type FakeProvider,
  startFakeProvider,
} from "./fake-provider.test-support";
import {
  IBKR_CREDENTIALS,
  IOL_CREDENTIALS,
  NEXO_CREDENTIALS,
  NOW,
  PROVIDER_FIXTURES,
  WALLBIT_CREDENTIALS,
} from "./fixtures.test-support";
import { ibkrConnection } from "./ibkr";
import { iolConnection } from "./iol";
import { nexoConnection } from "./nexo";
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
