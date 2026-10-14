import { createHmac } from "node:crypto";

import type { ConnectionProvider } from "./adapters";
import { binanceConnection } from "./binance";
import type { FakeReply, FakeRequest } from "./fake-provider.test-support";
import { ibkrConnection } from "./ibkr";
import { iolConnection } from "./iol";
import { nexoConnection } from "./nexo";
import type {
  ConnectionDeps,
  ConnectionProviderPort,
  Credentials,
} from "./port";
import { wallbitConnection } from "./wallbit";

// Each provider faked for its adapter, with made-up credentials and data:
// how it answers credentials that work and read only (`ok`), and how it
// refuses ones it does not take (`refuse`).
export type ProviderFixture = {
  make: (deps: ConnectionDeps) => ConnectionProviderPort;
  credentials: Credentials;
  ok: (request: FakeRequest) => FakeReply;
  refuse: (request: FakeRequest) => FakeReply;
  // The paths the adapter may POST to, besides GETs: a login.
  posts?: readonly string[];
  // The provider takes a secret in the query string by design.
  secretsInUrl?: boolean;
};

const json = (body: unknown, status = 200): FakeReply => ({ status, body });
const xml = (body: string, status = 200): FakeReply => ({
  status,
  body,
  type: "xml",
});

export const NOW = new Date("2026-10-14T15:00:00Z");

// ── Binance ─────────────────────────────────────────────────────────────────
export const BINANCE_CREDENTIALS = {
  apiKey: "TestKey0000000000000000000001",
  apiSecret: "TestSecret00000000000000000001",
};
export const BINANCE_READ_ONLY = {
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
export const BINANCE_BALANCES = [
  { asset: "ETH", free: "0.84000000", locked: "0.01000000" },
  { asset: "BTC", free: "0.01250000", locked: "0.00000000" },
  { asset: "USDT", free: "250.50000000", locked: "0.00000000" },
  { asset: "DUST", free: "0.00000000", locked: "0.00000000" },
  { asset: "bad name", free: "1.00000000", locked: "0.00000000" },
  { asset: "HUGE", free: "1000000000000.00000000", locked: "0.00000000" },
];
const binanceSigned = (request: FakeRequest) => {
  const raw = request.url.split("?")[1] ?? "";
  const payload = raw.replace(/&signature=[0-9a-f]+$/, "");
  return (
    request.headers["x-mbx-apikey"] === BINANCE_CREDENTIALS.apiKey &&
    request.query.get("signature") ===
      createHmac("sha256", BINANCE_CREDENTIALS.apiSecret)
        .update(payload)
        .digest("hex")
  );
};
const binance: ProviderFixture = {
  make: binanceConnection,
  credentials: BINANCE_CREDENTIALS,
  ok: (request) =>
    !binanceSigned(request)
      ? json({ code: -2015 }, 401)
      : request.path === "/sapi/v1/account/apiRestrictions"
        ? json(BINANCE_READ_ONLY)
        : request.path === "/api/v3/account"
          ? json({ balances: BINANCE_BALANCES })
          : json({}, 404),
  refuse: () => json({ code: -2015, msg: "Invalid API-key" }, 401),
};

// ── Wallbit ─────────────────────────────────────────────────────────────────
export const WALLBIT_CREDENTIALS = { apiKey: "wb_test_0000000000000001" };
const wallbitAuthorized = (request: FakeRequest) =>
  request.headers["x-api-key"] === WALLBIT_CREDENTIALS.apiKey;
export const WALLBIT_TRANSACTIONS = [
  {
    uuid: "550e8400-e29b-41d4-a716-446655440001",
    type: "TRADE",
    source_currency: { code: "USD", alias: "USD" },
    dest_currency: { code: "AAPL", alias: "AAPL" },
    source_amount: 100,
    dest_amount: 0.5847953,
    status: "COMPLETED",
    created_at: "2026-10-01T14:30:00.000000Z",
    comment: null,
  },
  {
    uuid: "550e8400-e29b-41d4-a716-446655440002",
    type: "TRADE",
    source_currency: { code: "TSLA", alias: "TSLA" },
    dest_currency: { code: "USD", alias: "USD" },
    source_amount: 1.5,
    dest_amount: 420.25,
    status: "COMPLETED",
    created_at: "2026-10-05T14:30:00.000000Z",
    comment: null,
  },
  {
    uuid: "550e8400-e29b-41d4-a716-446655440003",
    type: "TRADE",
    source_currency: { code: "EUR", alias: "EUR" },
    dest_currency: { code: "USD", alias: "USD" },
    source_amount: 10,
    dest_amount: 11,
    status: "COMPLETED",
    created_at: "2026-10-06T14:30:00.000000Z",
    comment: null,
  },
];
const wallbit: ProviderFixture = {
  make: wallbitConnection,
  credentials: WALLBIT_CREDENTIALS,
  ok: (request) =>
    !wallbitAuthorized(request)
      ? json({ message: "Invalid or expired API Key." }, 401)
      : request.path === "/api/public/v1/balance/checking"
        ? json({
            data: [
              { currency: "USD", balance: 1000.5 },
              { currency: "ARS", balance: 25000 },
              { currency: "EUR", balance: 3 },
            ],
          })
        : request.path === "/api/public/v1/balance/stocks"
          ? json({
              data: [
                { symbol: "AAPL", shares: 10.5 },
                { symbol: "TSLA", shares: 5.25 },
                { symbol: "USD", shares: 500 },
              ],
            })
          : request.path === "/api/public/v1/transactions"
            ? json({
                data: {
                  data: WALLBIT_TRANSACTIONS,
                  pages: 1,
                  current_page: 1,
                  count: WALLBIT_TRANSACTIONS.length,
                },
              })
            : json({}, 404),
  refuse: () => json({ message: "Invalid or expired API Key." }, 401),
};

// ── Interactive Brokers ─────────────────────────────────────────────────────
export const IBKR_CREDENTIALS = {
  token: "123456789012345678901234",
  queryId: "987654",
};
export const IBKR_STATEMENT = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Plant" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U0000000" fromDate="20260101" toDate="20261013" period="YearToDate" whenGenerated="20261014;100000">
<OpenPositions>
<OpenPosition accountId="U0000000" currency="USD" assetCategory="STK" symbol="AAPL" position="10" markPrice="230.5" positionValue="2305" costBasisPrice="180.25" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U0000000" currency="USD" assetCategory="STK" symbol="AAPL" position="10" markPrice="230.5" positionValue="2305" costBasisPrice="180.25" levelOfDetail="LOT" />
<OpenPosition accountId="U0000000" currency="USD" assetCategory="STK" symbol="SPY" position="2.5" markPrice="560" positionValue="1400" costBasisPrice="500" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U0000000" currency="EUR" assetCategory="STK" symbol="SAP" position="3" markPrice="200" positionValue="600" costBasisPrice="150" levelOfDetail="SUMMARY" />
</OpenPositions>
<CashReport>
<CashReportCurrency currency="BASE_SUMMARY" endingCash="812.4" />
<CashReportCurrency currency="USD" endingCash="812.4" />
</CashReport>
<Trades>
<Trade currency="USD" symbol="AAPL" tradeDate="20260915" quantity="10" tradePrice="175.5" proceeds="-1755" ibCommission="-1" buySell="BUY" tradeID="111" levelOfDetail="EXECUTION" />
<Trade currency="USD" symbol="AAPL" tradeDate="20260915" quantity="10" tradePrice="175.5" proceeds="-1755" ibCommission="-1" buySell="BUY" tradeID="111" levelOfDetail="ORDER" />
<Trade currency="USD" symbol="MSFT" tradeDate="20261002" quantity="-4" tradePrice="410" proceeds="1640" ibCommission="-1.2" buySell="SELL" tradeID="112" levelOfDetail="EXECUTION" />
</Trades>
<CashTransactions>
<CashTransaction currency="USD" symbol="SPY" type="Dividends" amount="3.21" dateTime="20260930" transactionID="113" levelOfDetail="DETAIL" />
</CashTransactions>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;
const ibkrPending = `<FlexStatementResponse timestamp="14 October, 2026 10:00 AM EDT"><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>`;
let ibkrAsks = 0;
const ibkr: ProviderFixture = {
  make: (deps) => ibkrConnection({ ...deps, sleep: async () => undefined }),
  credentials: IBKR_CREDENTIALS,
  secretsInUrl: true,
  ok: (request) => {
    if (request.query.get("t") !== IBKR_CREDENTIALS.token) {
      return xml(
        "<FlexStatementResponse><Status>Fail</Status><ErrorCode>1015</ErrorCode><ErrorMessage>Token is invalid.</ErrorMessage></FlexStatementResponse>",
      );
    }
    if (request.path.endsWith("/SendRequest")) {
      ibkrAsks = 0;
      return xml(
        "<FlexStatementResponse><Status>Success</Status><ReferenceCode>5550001</ReferenceCode><Url>https://example.invalid/GetStatement</Url></FlexStatementResponse>",
      );
    }
    if (request.path.endsWith("/GetStatement")) {
      // Generated on the second ask.
      ibkrAsks += 1;
      return xml(ibkrAsks < 2 ? ibkrPending : IBKR_STATEMENT);
    }
    return xml("", 404);
  },
  refuse: () =>
    xml(
      "<FlexStatementResponse><Status>Fail</Status><ErrorCode>1015</ErrorCode><ErrorMessage>Token is invalid.</ErrorMessage></FlexStatementResponse>",
    ),
};

// ── Nexo Pro ────────────────────────────────────────────────────────────────
export const NEXO_CREDENTIALS = {
  apiKey: "nexoKey00000001",
  apiSecret: "nexoSecret0000001",
};
const nexoSigned = (request: FakeRequest) =>
  request.headers["x-api-key"] === NEXO_CREDENTIALS.apiKey &&
  request.headers["x-signature"] ===
    createHmac("sha256", NEXO_CREDENTIALS.apiSecret)
      .update(String(request.headers["x-nonce"]))
      .digest("base64");
const nexo: ProviderFixture = {
  make: nexoConnection,
  credentials: NEXO_CREDENTIALS,
  ok: (request) =>
    !nexoSigned(request)
      ? json({ errorMessage: "Unauthorized", errorCode: 101 }, 401)
      : request.path === "/accountSummary"
        ? json({
            balances: [
              {
                assetName: "BTC",
                totalBalance: 0.05,
                availableBalance: 0.05,
                lockedBalance: 0,
                debt: 0,
                interest: 0,
              },
              {
                assetName: "USDT",
                totalBalance: 1200.75,
                availableBalance: 1200.75,
                lockedBalance: 0,
                debt: 0,
                interest: 0,
              },
              {
                assetName: "ETH",
                totalBalance: 0,
                availableBalance: 0,
                lockedBalance: 0,
                debt: 0,
                interest: 0,
              },
            ],
          })
        : json({}, 404),
  refuse: () => json({ errorMessage: "Unauthorized", errorCode: 101 }, 401),
};

// ── InvertirOnline ──────────────────────────────────────────────────────────
export const IOL_CREDENTIALS = {
  username: "ana.test",
  password: "MadeUpPassword!1",
};
const IOL_TOKEN = "made-up-bearer-token";
const iol: ProviderFixture = {
  make: iolConnection,
  credentials: IOL_CREDENTIALS,
  posts: ["/token"],
  ok: (request) => {
    if (request.path === "/token") {
      const form = new URLSearchParams(request.body);
      return form.get("username") === IOL_CREDENTIALS.username &&
        form.get("password") === IOL_CREDENTIALS.password &&
        form.get("grant_type") === "password"
        ? json({ access_token: IOL_TOKEN, refresh_token: "r", expires_in: 900 })
        : json({ error: "invalid_grant" }, 400);
    }
    if (request.headers.authorization !== `Bearer ${IOL_TOKEN}`) {
      return json({ message: "Authorization has been denied" }, 401);
    }
    if (request.path === "/api/v2/portafolio/argentina") {
      return json({
        pais: "argentina",
        activos: [
          {
            cantidad: 1500,
            ultimoPrecio: 73.4,
            ppc: 65.1,
            valorizado: 110100,
            titulo: {
              simbolo: "AL30",
              tipo: "TitulosPublicos",
              moneda: "peso_Argentino",
            },
          },
          {
            cantidad: 20,
            ultimoPrecio: 18500,
            ppc: 15000,
            valorizado: 370000,
            titulo: {
              simbolo: "AAPL",
              tipo: "CEDEARS",
              moneda: "peso_Argentino",
            },
          },
          {
            cantidad: 0,
            titulo: { simbolo: "GGAL", moneda: "peso_Argentino" },
          },
        ],
      });
    }
    if (request.path === "/api/v2/estadocuenta") {
      return json({
        cuentas: [
          { moneda: "peso_Argentino", saldo: 125000.5, disponible: 125000.5 },
          { moneda: "dolar_Estadounidense", saldo: 300, disponible: 300 },
        ],
      });
    }
    return json({}, 404);
  },
  refuse: (request) =>
    request.path === "/token"
      ? json({ error: "invalid_grant" }, 400)
      : json({}, 401),
};

export const PROVIDER_FIXTURES: Record<ConnectionProvider, ProviderFixture> = {
  binance,
  wallbit,
  ibkr,
  nexo,
  iol,
};
