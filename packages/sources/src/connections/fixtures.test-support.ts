import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";

import type { ConnectionProvider } from "./adapters";
import { binanceConnection } from "./binance";
import { bitsoConnection } from "./bitso";
import type { FakeReply, FakeRequest } from "./fake-provider.test-support";
import { ibkrConnection } from "./ibkr";
import { iolConnection } from "./iol";
import { mercadoPagoConnection } from "./mercadopago";
import { nexoConnection } from "./nexo";
import type {
  ConnectionDeps,
  ConnectionProviderPort,
  Credentials,
} from "./port";
import { ripioConnection } from "./ripio";
import { roxomConnection } from "./roxom";
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
    if (request.path === "/api/v2/operaciones") {
      return json([
        {
          numero: 51234567,
          fechaOrden: "2026-09-02T11:15:00",
          tipo: "Compra",
          estado: "terminada",
          mercado: "bCBA",
          simbolo: "AL30",
          cantidad: 1000,
          monto: 73400,
          precio: 73.4,
          fechaOperada: "2026-09-02T11:15:04",
          cantidadOperada: 1000,
          precioOperado: 73.4,
          montoOperado: 73400,
        },
        {
          numero: 51234890,
          fechaOrden: "2026-09-20T14:02:00",
          tipo: "Venta",
          estado: "terminada",
          mercado: "bCBA",
          simbolo: "AAPL",
          cantidad: 5,
          precio: 18400,
          fechaOperada: "2026-09-20T14:02:09",
        },
        {
          numero: 51235001,
          fechaOrden: "2026-09-25T10:00:00",
          tipo: "Suscripción FCI",
          estado: "terminada",
          mercado: "bCBA",
          simbolo: "PRPEDOB",
          monto: 50000,
        },
      ]);
    }
    return json({}, 404);
  },
  refuse: (request) =>
    request.path === "/token"
      ? json({ error: "invalid_grant" }, 400)
      : json({}, 401),
};

// ── Roxom ───────────────────────────────────────────────────────────────────
// A key pair made for the tests: Roxom keeps the public half.
const roxomKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const ROXOM_CREDENTIALS = {
  apiKey: "rxk_key_0000000000000001",
  privateKey: roxomKeys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
};
const roxomSigned = (request: FakeRequest) =>
  request.headers["x-api-key"] === ROXOM_CREDENTIALS.apiKey &&
  createVerify("sha256")
    .update(`${request.method}:${request.url}`)
    .verify(
      roxomKeys.publicKey,
      String(request.headers["x-api-signature"] ?? ""),
      "base64",
    );
const roxom: ProviderFixture = {
  make: roxomConnection,
  credentials: ROXOM_CREDENTIALS,
  ok: (request) =>
    !roxomSigned(request)
      ? json({ error: 401, message: "Unauthorized" }, 401)
      : request.path === "/v1/accounts/balance" &&
          request.query.get("unit") === "btc"
        ? json({
            error: false,
            data: {
              lastUpdated: NOW.getTime(),
              balances: [
                {
                  asset: "BTC",
                  assetClass: "crypto",
                  available: "0.10000000",
                  current: "0.12500000",
                  lockedInOrders: "0.02500000",
                },
                {
                  asset: "USDT",
                  assetClass: "crypto",
                  available: "350.00000000",
                  current: "350.00000000",
                },
                {
                  asset: "USDC",
                  assetClass: "crypto",
                  available: "0.00000000",
                  current: "0.00000000",
                },
              ],
            },
          })
        : json({}, 404),
  refuse: () => json({ error: 401, message: "Unauthorized" }, 401),
};

// ── Mercado Pago ────────────────────────────────────────────────────────────
export const MERCADO_PAGO_CREDENTIALS = {
  accessToken: "APP_USR-0000000000000001-101412-made0up0token0000000-123456789",
};
export const MERCADO_PAGO_REPORT = [
  "DATE,SOURCE_ID,EXTERNAL_REFERENCE,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT,BALANCE_AMOUNT,CURRENCY",
  "2026-10-07T15:00:00.000-04:00,,,initial_available_balance,,0.00,0.00,0.00,180000.00,ARS",
  '2026-10-09T10:12:00.000-04:00,111,,release,"Pago, cuota 1",25000.50,0.00,26000.00,205000.50,ARS',
  "2026-10-12T09:00:00.000-04:00,112,,available_balance,pre_payout_1,0.00,0.00,0.00,205000.50,ARS",
  "2026-10-12T09:00:00.000-04:00,112,,payout,Retiro,0.00,5000.00,0.00,200000.50,ARS",
  "2026-10-14T11:00:00.000-04:00,,,total,,25000.50,5000.00,26000.00,,ARS",
].join("\n");
type MercadoPagoReport = {
  begin_date: string;
  end_date: string;
  file_name: string;
  status: string;
};
// The reports Mercado Pago lists: one asked for is pending on the first list
// after it, and processed from then on.
let mercadoPagoReports: MercadoPagoReport[] = [];
export const resetMercadoPagoReports = () => {
  mercadoPagoReports = [];
};
const MERCADO_PAGO_FILE = "release-report-123456789-2026-10-14-150000.csv";
const mercadoPago: ProviderFixture = {
  make: (deps) =>
    mercadoPagoConnection({ ...deps, sleep: async () => undefined }),
  credentials: MERCADO_PAGO_CREDENTIALS,
  posts: ["/v1/account/release_report"],
  ok: (request) => {
    if (
      request.headers.authorization !==
      `Bearer ${MERCADO_PAGO_CREDENTIALS.accessToken}`
    ) {
      return json({ message: "invalid access token", status: 401 }, 401);
    }
    if (request.path === "/users/me") {
      return json({ id: 123456789, site_id: "MLA" });
    }
    if (
      request.method === "POST" &&
      request.path === "/v1/account/release_report"
    ) {
      const { begin_date, end_date } = JSON.parse(request.body) as {
        begin_date: string;
        end_date: string;
      };
      mercadoPagoReports.push({
        begin_date,
        end_date,
        file_name: MERCADO_PAGO_FILE,
        status: "pending",
      });
      return json({ id: 1, status: "pending" }, 202);
    }
    if (request.path === "/v1/account/release_report/list") {
      const listed = mercadoPagoReports.map((each) => ({ ...each }));
      for (const each of mercadoPagoReports) each.status = "processed";
      return json(listed);
    }
    if (request.path === `/v1/account/release_report/${MERCADO_PAGO_FILE}`) {
      return { status: 200, type: "text", body: MERCADO_PAGO_REPORT };
    }
    return json({}, 404);
  },
  refuse: () => json({ message: "invalid access token", status: 401 }, 401),
};

// ── Bitso ───────────────────────────────────────────────────────────────────
export const BITSO_CREDENTIALS = {
  apiKey: "BitsoKey01",
  apiSecret: "bitsoSecret00000000000000000001",
};
const bitsoSigned = (request: FakeRequest) => {
  const [scheme, rest = ""] = String(request.headers.authorization).split(" ");
  const [key, nonce = "", signature] = rest.split(":");
  return (
    scheme === "Bitso" &&
    key === BITSO_CREDENTIALS.apiKey &&
    /^\d{19}$/.test(nonce) &&
    signature ===
      createHmac("sha256", BITSO_CREDENTIALS.apiSecret)
        .update(`${nonce}${request.method}${request.url}`)
        .digest("hex")
  );
};
const bitsoRefused = json(
  {
    success: false,
    error: { code: "0201", message: "Invalid Nonce or Invalid Credentials" },
  },
  401,
);
const bitso: ProviderFixture = {
  make: bitsoConnection,
  credentials: BITSO_CREDENTIALS,
  ok: (request) =>
    !bitsoSigned(request)
      ? bitsoRefused
      : request.path === "/api/v3/balance/"
        ? json({
            success: true,
            payload: {
              balances: [
                {
                  currency: "btc",
                  total: "0.03000000",
                  locked: "0.01000000",
                  available: "0.02000000",
                },
                {
                  currency: "ars",
                  total: "52000.75",
                  locked: "0.00",
                  available: "52000.75",
                },
                {
                  currency: "mxn",
                  total: "300.00",
                  locked: "0.00",
                  available: "300.00",
                },
                {
                  currency: "eth",
                  total: "0.00000000",
                  locked: "0.00000000",
                  available: "0.00000000",
                },
              ],
            },
          })
        : json({}, 404),
  refuse: () => bitsoRefused,
};

// ── Ripio Trade ─────────────────────────────────────────────────────────────
export const RIPIO_CREDENTIALS = {
  apiToken: "ripioToken0000000000000001",
  secretKey: "ripioSecret000000000000001",
};
const ripioSigned = (request: FakeRequest) =>
  request.headers.authorization === RIPIO_CREDENTIALS.apiToken &&
  request.headers.signature ===
    createHmac("sha256", RIPIO_CREDENTIALS.secretKey)
      .update(`${String(request.headers.timestamp)}GET${request.path}`)
      .digest("base64");
const ripioRefused = json(
  { data: null, error_code: 40100, message: "Not authorized" },
  401,
);
const ripio: ProviderFixture = {
  make: ripioConnection,
  credentials: RIPIO_CREDENTIALS,
  ok: (request) =>
    !ripioSigned(request)
      ? ripioRefused
      : request.path === "/user/balances"
        ? json({
            data: [
              {
                available_amount: 0.0215,
                currency_code: "BTC",
                last_update: "2026-10-14T12:00:00.000Z",
                locked_amount: 0.001,
              },
              {
                available_amount: 150000.5,
                currency_code: "ARS",
                last_update: "2026-10-14T12:00:00.000Z",
                locked_amount: 0,
              },
              {
                available_amount: 10,
                currency_code: "BRL",
                last_update: "2026-10-14T12:00:00.000Z",
                locked_amount: 0,
              },
              {
                available_amount: 80.25,
                currency_code: "USDC",
                last_update: "2026-10-14T12:00:00.000Z",
                locked_amount: 0,
              },
            ],
            error_code: null,
            message: null,
          })
        : json({}, 404),
  refuse: () => ripioRefused,
};

export const PROVIDER_FIXTURES: Record<ConnectionProvider, ProviderFixture> = {
  binance,
  wallbit,
  ibkr,
  nexo,
  iol,
  roxom,
  mercadopago: mercadoPago,
  bitso,
  ripio,
};
