import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { SourceError } from "../file-upload/draft";
import type { HoldingsReading } from "../port";
import { connectionAdapters } from "./adapters";
import { binanceConnection } from "./binance";

// Made-up credentials; the fake answers only requests they sign.
const CREDENTIALS = {
  apiKey: "TestKey0000000000000000000001",
  apiSecret: "TestSecret00000000000000000001",
};
const NOW = new Date("2026-10-14T15:00:00Z");

const READ_ONLY = {
  ipRestrict: false,
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  permitsUniversalTransfer: false,
  enableSpotAndMarginTrading: false,
  enableMargin: false,
  enableFutures: false,
  enableVanillaOptions: false,
  enableFixApiTrade: false,
  enableFixReadOnly: true,
};

const BALANCES = [
  { asset: "ETH", free: "0.84000000", locked: "0.01000000" },
  { asset: "BTC", free: "0.01250000", locked: "0.00000000" },
  { asset: "USDT", free: "250.50000000", locked: "0.00000000" },
  { asset: "DUST", free: "0.00000000", locked: "0.00000000" },
  { asset: "bad name", free: "1.00000000", locked: "0.00000000" },
  { asset: "HUGE", free: "1000000000000.00000000", locked: "0.00000000" },
];

type Reply = { status: number; body: unknown };
type Fake = {
  url: string;
  requests: { path: string; query: URLSearchParams; key: string }[];
  replies: Record<string, Reply>;
};

let server: Server;
let fake: Fake;

function signedBy(request: IncomingMessage, query: URLSearchParams): boolean {
  const signature = query.get("signature");
  const raw = (request.url ?? "").split("?")[1] ?? "";
  const payload = raw.replace(/&signature=[0-9a-f]+$/, "");
  const expected = createHmac("sha256", CREDENTIALS.apiSecret)
    .update(payload)
    .digest("hex");
  return signature === expected;
}

beforeAll(async () => {
  fake = { url: "", requests: [], replies: {} };
  server = createServer((request, response) => {
    const [path = "", raw = ""] = (request.url ?? "").split("?");
    const query = new URLSearchParams(raw);
    fake.requests.push({
      path,
      query,
      key: String(request.headers["x-mbx-apikey"] ?? ""),
    });
    const reply: Reply =
      request.method !== "GET"
        ? { status: 405, body: {} }
        : request.headers["x-mbx-apikey"] !== CREDENTIALS.apiKey ||
            !signedBy(request, query)
          ? { status: 401, body: { code: -2015, msg: "Invalid API-key" } }
          : (fake.replies[path] ?? { status: 404, body: {} });
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  fake.requests = [];
  fake.replies = {
    "/sapi/v1/account/apiRestrictions": { status: 200, body: READ_ONLY },
    "/api/v3/account": {
      status: 200,
      body: { canTrade: true, balances: BALANCES },
    },
  };
});

const source = () => binanceConnection({ baseUrl: fake.url, now: () => NOW });

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SourceError);
  const { code, retryable } = error as SourceError;
  return { code, retryable };
};

describe("binanceConnection", () => {
  it("reads the balances held as a draft of holdings, free and locked added up", async () => {
    const reading = (await source().read(
      CREDENTIALS,
      "holdings",
    )) as HoldingsReading;
    expect(reading.draft).toEqual({
      documentDate: "2026-10-14",
      rows: ["BTC", "ETH", "USDT"].map((symbol) =>
        expect.objectContaining({ symbol, currency: "USD", price: null }),
      ),
      totals: [],
    });
    expect(reading.draft.rows.map((row) => row.quantity)).toEqual([
      "0.0125",
      "0.85",
      "250.5",
    ]);
    expect(reading.draft.rows.every((row) => row.confidence === "high")).toBe(
      true,
    );
    // A name Binance does not use and more units than a quantity holds.
    expect(reading.read).toEqual({
      reader: "api",
      mapping: "none",
      skippedRows: 2,
      disputes: 0,
      documentKind: null,
    });
  });

  it("signs every request with the key's secret, sends the key in its header and only reads", async () => {
    await source().read(CREDENTIALS, "holdings");
    expect(fake.requests.map((each) => each.path)).toEqual([
      "/sapi/v1/account/apiRestrictions",
      "/api/v3/account",
    ]);
    for (const request of fake.requests) {
      expect(request.key).toBe(CREDENTIALS.apiKey);
      expect(request.query.get("timestamp")).toBe(String(NOW.getTime()));
      expect(request.query.get("signature")).toMatch(/^[0-9a-f]{64}$/);
      expect([...request.query.values()].join(" ")).not.toContain(
        CREDENTIALS.apiSecret,
      );
    }
    expect(fake.requests[1]!.query.get("omitZeroBalances")).toBe("true");
  });

  it.each([
    "enableSpotAndMarginTrading",
    "enableWithdrawals",
    "enableInternalTransfer",
    "permitsUniversalTransfer",
    "enableFutures",
    "enableMargin",
    "enableSomethingNew",
  ])("refuses a key with %s before reading any balance", async (permission) => {
    fake.replies["/sapi/v1/account/apiRestrictions"] = {
      status: 200,
      body: { ...READ_ONLY, [permission]: true },
    };
    expect(await failure(source().read(CREDENTIALS, "holdings"))).toEqual({
      code: "connection_not_read_only",
      retryable: false,
    });
    expect(fake.requests.map((each) => each.path)).not.toContain(
      "/api/v3/account",
    );
  });

  it("takes a read-only key, with the fields that grant nothing set to anything", async () => {
    fake.replies["/sapi/v1/account/apiRestrictions"] = {
      status: 200,
      body: {
        ...READ_ONLY,
        ipRestrict: true,
        createTime: 1700000000000,
        tradingAuthorityExpirationTime: 1800000000000,
      },
    };
    await expect(source().check(CREDENTIALS)).resolves.toBeUndefined();
  });

  it.each([
    ["a field it does not know, granted as true", { newPower: true }],
    ["a permission answered as a string", { enableWithdrawals: "true" }],
    ["a permission answered as a number", { enableInternalTransfer: 1 }],
    ["a permission answered as null", { enableSpotAndMarginTrading: null }],
    ["a field it does not know, of any value", { somethingElse: "x" }],
  ])("refuses a key with %s", async (_, extra) => {
    fake.replies["/sapi/v1/account/apiRestrictions"] = {
      status: 200,
      body: { ...READ_ONLY, ...extra },
    };
    expect(await failure(source().check(CREDENTIALS))).toEqual({
      code: "connection_not_read_only",
      retryable: false,
    });
  });

  it("is built against Binance's real API by the shared factory", async () => {
    const get = jest.fn(async () => {
      throw new Error("offline");
    });
    const adapter = connectionAdapters({ fetch: get as never }).binance();
    expect(adapter.provider).toBe("binance");
    await adapter.check(CREDENTIALS).catch(() => undefined);
    expect(String((get.mock.calls[0] as unknown[])[0])).toMatch(
      /^https:\/\/api\.binance\.com\/sapi\/v1\/account\/apiRestrictions\?/,
    );
  });

  it("refuses a key Binance does not take, and one that cannot read", async () => {
    expect(
      await failure(
        source().check({
          ...CREDENTIALS,
          apiSecret: "Wrong0000000000000000",
        }),
      ),
    ).toEqual({ code: "connection_rejected", retryable: false });
    fake.replies["/sapi/v1/account/apiRestrictions"] = {
      status: 200,
      body: { ...READ_ONLY, enableReading: false },
    };
    expect(await failure(source().check(CREDENTIALS))).toEqual({
      code: "connection_rejected",
      retryable: false,
    });
  });

  it("fails for a later attempt when Binance limits the rate, errs or answers something else", async () => {
    for (const reply of [
      { status: 429, body: { code: -1003 } },
      { status: 400, body: { code: -1021 } },
      { status: 503, body: {} },
      { status: 200, body: { balances: "none" } },
    ]) {
      fake.replies["/api/v3/account"] = reply;
      expect(await failure(source().read(CREDENTIALS, "holdings"))).toEqual({
        code: "extraction_failed",
        retryable: true,
      });
    }
  });

  it("fails for a later attempt when Binance cannot be reached", async () => {
    const down = binanceConnection({
      baseUrl: "http://127.0.0.1:1",
      now: () => NOW,
      timeoutMs: 2000,
    });
    expect(await failure(down.check(CREDENTIALS))).toEqual({
      code: "extraction_failed",
      retryable: true,
    });
  });
});
