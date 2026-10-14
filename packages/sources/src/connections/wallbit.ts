import { buenosAiresDate, fromScaled, toScaled } from "@plant/shared";
import { z } from "zod";

import type { DraftOperation, DraftRow } from "../file-upload/draft";
import {
  call,
  cashRow,
  decimalOf,
  holdingsReading,
  isZero,
  jsonOf,
  notReadOnly,
  operationsReading,
  positive,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";

export const WALLBIT_BASE_URL = "https://api.wallbit.io";

const API = "/api/public/v1";

export const wallbitCredentialsSchema = z.object({
  apiKey: z.string().regex(/^[A-Za-z0-9_.-]{16,256}$/),
});
type WallbitCredentials = z.infer<typeof wallbitCredentialsSchema>;

// The most pages of transactions a sync reads, and how many each holds: a
// draft holds 500.
const TRANSACTION_PAGES = 10;
const TRANSACTION_PAGE_SIZE = 50;

const checkingSchema = z.object({
  data: z.array(z.object({ currency: z.string(), balance: z.unknown() })),
});
const stocksSchema = z.object({
  data: z.array(z.object({ symbol: z.string(), shares: z.unknown() })),
});
const currencySchema = z.object({ code: z.string() }).nullable().optional();
const transactionsSchema = z.object({
  data: z.object({
    data: z.array(
      z.object({
        uuid: z.string(),
        type: z.string(),
        source_currency: currencySchema,
        dest_currency: currencySchema,
        source_amount: z.unknown(),
        dest_amount: z.unknown(),
        status: z.string(),
        created_at: z.string(),
      }),
    ),
    pages: z.number().int().nonnegative(),
    count: z.number().int().nonnegative().optional(),
  }),
});
const forbiddenSchema = z.object({
  your_permissions: z.array(z.string()).optional(),
});

// A symbol as Wallbit names an asset or a currency.
const SYMBOL = /^[A-Z0-9.]{1,20}$/;

// The currencies Wallbit holds, as its API lists them: never an asset.
const CURRENCIES = new Set([
  "USD",
  "EUR",
  "ARS",
  "MXN",
  "USDC",
  "USDT",
  "BOB",
  "COP",
  "PEN",
  "DOP",
  "BRL",
  "PHP",
  "CLP",
  "GTQ",
  "PAB",
  "CRC",
]);

// The stablecoins Wallbit holds, each a crypto instrument valued in dollars.
const STABLECOINS = new Set(["USDC", "USDT"]);

// Wallbit by API with a key the user made with the `read` permission only.
// Wallbit does not say what a key may do unless a call needs more, so the
// user confirms it reads only, and a key Wallbit answers it holds `trade`
// for is refused. Plant calls only GETs.
export function wallbitConnection({
  baseUrl = WALLBIT_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
}: ConnectionDeps = {}) {
  const read = async (
    path: string,
    { apiKey }: WallbitCredentials,
  ): Promise<unknown> => {
    const response = await call(
      get,
      `${baseUrl}${API}${path}`,
      { headers: { "X-API-Key": apiKey, Accept: "application/json" } },
      timeoutMs,
    );
    const body = await jsonOf(response);
    if (response.ok) return body;
    if (response.status === 403) {
      const permissions =
        forbiddenSchema.safeParse(body).data?.your_permissions ?? [];
      if (permissions.includes("trade")) throw notReadOnly();
      throw rejected();
    }
    if (response.status === 401) throw rejected();
    throw unavailable();
  };

  const holdings = async (credentials: WallbitCredentials) => {
    const [checking, stocks] = [
      checkingSchema.safeParse(await read("/balance/checking", credentials)),
      stocksSchema.safeParse(await read("/balance/stocks", credentials)),
    ];
    if (!checking.success || !stocks.success) throw unavailable();
    // The same symbol in both accounts (dollars) adds up into one row. Pesos
    // and dollars are cash, stablecoins and assets instruments in dollars,
    // any other currency one Plant does not keep.
    const held = new Map<string, bigint>();
    let skipped = 0;
    const add = (symbol: string, amount: unknown) => {
      const quantity = decimalOf(amount);
      if (
        !SYMBOL.test(symbol) ||
        quantity === null ||
        (CURRENCIES.has(symbol) &&
          symbol !== "ARS" &&
          symbol !== "USD" &&
          !STABLECOINS.has(symbol))
      ) {
        skipped += 1;
        return;
      }
      if (isZero(quantity)) return;
      try {
        held.set(symbol, (held.get(symbol) ?? 0n) + toScaled(quantity));
      } catch {
        skipped += 1;
      }
    };
    for (const { currency, balance } of checking.data.data) {
      add(currency, balance);
    }
    for (const { symbol, shares } of stocks.data.data) add(symbol, shares);
    const rows: DraftRow[] = [];
    for (const [symbol, units] of held) {
      const quantity = fromScaled(units);
      if (!positive(quantity)) skipped += 1;
      else if (symbol === "ARS" || symbol === "USD") {
        rows.push(cashRow(symbol, quantity, "high"));
      } else {
        rows.push({
          symbol,
          quantity,
          price: null,
          value: null,
          currency: "USD",
          confidence: "high",
          page: null,
        });
      }
    }
    return holdingsReading(rows, skipped, now());
  };

  // A completed trade as an operation: dollars out for an asset is a
  // purchase, an asset out for dollars a sale. Anything else (a currency
  // exchange) is skipped.
  const operationOf = (
    each: z.infer<typeof transactionsSchema>["data"]["data"][number],
  ): DraftOperation | null => {
    const source = each.source_currency?.code ?? "";
    const dest = each.dest_currency?.code ?? "";
    const sourceAmount = decimalOf(each.source_amount);
    const destAmount = decimalOf(each.dest_amount);
    const buying = source === "USD" && !CURRENCIES.has(dest);
    const selling = dest === "USD" && !CURRENCIES.has(source);
    if (!buying && !selling) return null;
    const [symbol, quantity, amount] = buying
      ? [dest, destAmount, sourceAmount]
      : [source, sourceAmount, destAmount];
    if (!SYMBOL.test(symbol) || !positive(quantity) || !positive(amount)) {
      return null;
    }
    const at = new Date(each.created_at);
    return {
      date: Number.isNaN(at.getTime()) ? null : buenosAiresDate(at),
      kind: buying ? "purchase" : "sale",
      symbol,
      quantity,
      price: null,
      amount,
      charges: null,
      reference: each.uuid.slice(0, 40),
      currency: "USD",
      // How Wallbit lays out a trade's two sides is read from its
      // examples, so the review asks the user to look.
      confidence: "medium",
      page: null,
    };
  };

  const operations = async (credentials: WallbitCredentials) => {
    const found: DraftOperation[] = [];
    let skipped = 0;
    for (let page = 1; page <= TRANSACTION_PAGES; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(TRANSACTION_PAGE_SIZE),
        status: "COMPLETED",
        type: "TRADE",
      });
      const parsed = transactionsSchema.safeParse(
        await read(`/transactions?${query}`, credentials),
      );
      if (!parsed.success) throw unavailable();
      for (const each of parsed.data.data.data) {
        const operation = operationOf(each);
        if (operation) found.push(operation);
        else skipped += 1;
      }
      const { pages, count } = parsed.data.data;
      if (page >= pages) break;
      // The trades on the pages a sync does not read are counted: all Wallbit
      // says it has past the ones read, or else a full page each.
      if (page === TRANSACTION_PAGES) {
        const read = TRANSACTION_PAGES * TRANSACTION_PAGE_SIZE;
        skipped +=
          count !== undefined
            ? Math.max(0, count - read)
            : (pages - TRANSACTION_PAGES) * TRANSACTION_PAGE_SIZE;
      }
    }
    return operationsReading(found, skipped);
  };

  return defineConnection({
    provider: "wallbit",
    credentials: wallbitCredentialsSchema,
    secrets: ["apiKey"],
    hintField: "apiKey",
    readOnly: "confirmed",
    drafts: ["holdings", "operations"],
    async check(credentials) {
      if (
        !checkingSchema.safeParse(await read("/balance/checking", credentials))
          .success
      ) {
        throw unavailable();
      }
    },
    read: (credentials, draft) =>
      draft === "holdings" ? holdings(credentials) : operations(credentials),
  });
}
