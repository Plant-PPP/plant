import { type ConnectionProvider, connectionAdapters } from "@plant/sources";

import {
  type ApiKeyInput,
  type ConnectResult,
  keyHintOf,
  needsConfirmation,
  PROVIDERS,
  providerOf,
  type SyncResult,
} from "@/lib/connections/api-key";
import { importOrigin } from "@/lib/imports/origin";
import type { ImportItem, ImportRow } from "@/lib/imports/review";

import { priceToday, type PrototypeState, type Write } from "./prototype-store";

// Made-up credentials with "TRADE" in any field stand for ones that can
// trade, so the prototype shows the refusal where the provider would tell.
const TRADES = /trade/i;

// The providers that tell Plant a key can trade: Binance when asked, Wallbit
// when it answers that a key holds `trade`.
const TELLS_TRADING: ReadonlySet<ConnectionProvider> = new Set([
  "binance",
  "wallbit",
]);

// What each made-up account holds, in units, of instruments the prototype
// knows.
const BALANCES: Record<
  ConnectionProvider,
  readonly { symbol: string; quantity: string }[]
> = {
  binance: [
    { symbol: "BTC", quantity: "0.0125" },
    { symbol: "ETH", quantity: "0.85" },
    { symbol: "SOL", quantity: "12.4" },
  ],
  wallbit: [
    { symbol: "AAPL", quantity: "10.5" },
    { symbol: "MSFT", quantity: "3" },
  ],
  ibkr: [
    { symbol: "SPY", quantity: "2.5" },
    { symbol: "NVDA", quantity: "8" },
  ],
  nexo: [
    { symbol: "BTC", quantity: "0.05" },
    { symbol: "ETH", quantity: "1.2" },
  ],
  iol: [
    { symbol: "AL30", quantity: "1500" },
    { symbol: "MELI", quantity: "4" },
  ],
  roxom: [{ symbol: "BTC", quantity: "0.125" }],
  // The prototype has no cash to sync: the money in the account stands as
  // the money market fund it earns in.
  mercadopago: [{ symbol: "FIMAAHO", quantity: "200000" }],
  bitso: [
    { symbol: "BTC", quantity: "0.03" },
    { symbol: "ETH", quantity: "0.4" },
  ],
  ripio: [
    { symbol: "BTC", quantity: "0.0225" },
    { symbol: "SOL", quantity: "5" },
  ],
};

export function connectApiKey(
  state: PrototypeState,
  input: ApiKeyInput,
): Write<ConnectResult> {
  const refuse = (code: Extract<ConnectResult, { ok: false }>["code"]) => ({
    state,
    result: { ok: false as const, code },
  });
  const account = state.accounts.find((each) => each.id === input.accountId);
  if (!account) return refuse("not_found");
  if (providerOf(account.institution) !== input.provider) {
    return refuse("unsupported");
  }
  const adapter = connectionAdapters()[input.provider]();
  const credentials = adapter.parse(input.credentials);
  if (!credentials) return refuse("invalid");
  if (needsConfirmation(adapter.readOnly) && !input.confirmedReadOnly) {
    return refuse("unconfirmed");
  }
  if (
    TELLS_TRADING.has(input.provider) &&
    Object.values(credentials).some((value) => TRADES.test(value))
  ) {
    return refuse("not_read_only");
  }
  const apiKeys = new Map(state.apiKeys);
  apiKeys.set(input.accountId, {
    provider: input.provider,
    keyHint: keyHintOf(credentials[adapter.hintField] ?? ""),
    connectedOn: state.today,
  });
  return { state: { ...state, apiKeys }, result: { ok: true } };
}

export function disconnectApiKey(
  state: PrototypeState,
  accountId: string,
): Write<{ ok: boolean }> {
  const apiKeys = new Map(state.apiKeys);
  const ok = apiKeys.delete(accountId);
  return { state: ok ? { ...state, apiKeys } : state, result: { ok } };
}

const syncName = (provider: ConnectionProvider) =>
  importOrigin({
    source_connection_id: "-",
    provider,
    sync_draft: "holdings",
    document: null,
  }).fileName;

// Queues a sync of the account's holdings, as the real one inserts its
// import; it counts against no month's uploads.
export function addSync(
  state: PrototypeState,
  { id, accountId }: { id: string; accountId: string },
): Write<SyncResult> {
  const key = state.apiKeys.get(accountId);
  if (!key || !state.accounts.some((each) => each.id === accountId)) {
    return { state, result: { ok: false, code: "not_connected" } };
  }
  const syncing = state.imports.some(
    (each) =>
      each.accountId === accountId &&
      each.fileName === syncName(key.provider) &&
      (each.status === "queued" || each.status === "reading"),
  );
  if (syncing) return { state, result: { ok: false, code: "in_progress" } };
  const item: ImportItem = {
    id,
    fileName: syncName(key.provider),
    accountId,
    status: "queued",
    error: null,
    documentDate: null,
    documentTotals: [],
    skippedRows: 0,
    origin: "sync",
    rows: [],
    createdOn: state.today,
  };
  return {
    state: { ...state, imports: [item, ...state.imports] },
    result: { ok: true, importId: id },
  };
}

// What the sync reads, standing in for the provider: the made-up holdings of
// the instruments Plant knows, at today's price.
export function finishSync(state: PrototypeState, id: string): PrototypeState {
  const item = state.imports.find((each) => each.id === id);
  const provider = item && state.apiKeys.get(item.accountId)?.provider;
  if (!item || !provider) return state;
  const rows: ImportRow[] = BALANCES[provider].flatMap(
    ({ symbol, quantity }, index) => {
      const instrument = state.instruments.find(
        (each) => each.symbol === symbol,
      );
      if (!instrument) return [];
      return [
        {
          id: `${id}-${index}`,
          symbol,
          quantity,
          price: priceToday(state, instrument),
          currency: instrument.currency,
          confidence: "high" as const,
          source: PROVIDERS[provider].name,
          discarded: false,
        },
      ];
    },
  );
  return {
    ...state,
    imports: state.imports.map((each) =>
      each.id === id
        ? { ...each, status: "ready", documentDate: state.today, rows }
        : each,
    ),
  };
}
