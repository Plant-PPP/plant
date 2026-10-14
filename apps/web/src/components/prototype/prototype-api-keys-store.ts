import { exchangeCredentialsSchema } from "@plant/sources";

import type {
  ApiKeyInput,
  ConnectResult,
  SyncResult,
} from "@/lib/connections/api-key";
import { SYNC_NAMES } from "@/lib/imports/origin";
import type { ImportItem, ImportRow } from "@/lib/imports/review";

import { priceToday, type PrototypeState, type Write } from "./prototype-store";

// A made-up key that stands for one that can trade: any key with "TRADE" in
// it, so the prototype shows the refusal.
const TRADES = /trade/i;

// What a made-up Binance account holds, in units.
const BALANCES: readonly { symbol: string; quantity: string }[] = [
  { symbol: "BTC", quantity: "0.0125" },
  { symbol: "ETH", quantity: "0.85" },
  { symbol: "SOL", quantity: "12.4" },
];

export function connectApiKey(
  state: PrototypeState,
  input: ApiKeyInput,
): Write<ConnectResult> {
  const refuse = (code: Extract<ConnectResult, { ok: false }>["code"]) => ({
    state,
    result: { ok: false as const, code },
  });
  if (!state.accounts.some((each) => each.id === input.accountId)) {
    return refuse("not_found");
  }
  const credentials = exchangeCredentialsSchema.safeParse({
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
  });
  if (!credentials.success) return refuse("invalid");
  if (TRADES.test(input.apiKey)) return refuse("not_read_only");
  const apiKeys = new Map(state.apiKeys);
  apiKeys.set(input.accountId, {
    provider: input.provider,
    keyHint: input.apiKey.slice(-4),
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

// Queues a sync of the account, as the real one inserts its import; it
// counts against no month's uploads.
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
      each.fileName === SYNC_NAMES[key.provider] &&
      (each.status === "queued" || each.status === "reading"),
  );
  if (syncing) return { state, result: { ok: false, code: "in_progress" } };
  const item: ImportItem = {
    id,
    fileName: SYNC_NAMES[key.provider],
    accountId,
    status: "queued",
    error: null,
    documentDate: null,
    documentTotals: [],
    skippedRows: 0,
    rows: [],
    createdOn: state.today,
  };
  return {
    state: { ...state, imports: [item, ...state.imports] },
    result: { ok: true, importId: id },
  };
}

// What the sync reads, standing in for Binance: the made-up balances of the
// instruments Plant knows, at today's price.
export function finishSync(state: PrototypeState, id: string): PrototypeState {
  const rows: ImportRow[] = BALANCES.flatMap(({ symbol, quantity }, index) => {
    const instrument = state.instruments.find((each) => each.symbol === symbol);
    if (!instrument) return [];
    return [
      {
        id: `${id}-${index}`,
        symbol,
        quantity,
        price: priceToday(state, instrument),
        currency: instrument.currency,
        confidence: "high" as const,
        source: "Binance",
        discarded: false,
      },
    ];
  });
  return {
    ...state,
    imports: state.imports.map((each) =>
      each.id === id
        ? {
            ...each,
            status: "ready",
            documentDate: state.today,
            rows,
          }
        : each,
    ),
  };
}
