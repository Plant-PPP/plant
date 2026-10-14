import type { Currency } from "@plant/shared";
import { z } from "zod";

import type { DraftOperation, DraftRow } from "../file-upload/draft";
import {
  bodyText,
  budgetedRead,
  call,
  summedCashRows,
  decimalOf,
  defaultSleep,
  holdingsReading,
  isZero,
  operationsReading,
  positive,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";
import { elements, textOf } from "./xml";

export const IBKR_FLEX_BASE_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

export const ibkrCredentialsSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9]{10,64}$/),
  queryId: z.string().regex(/^[0-9]{1,12}$/),
});
type IbkrCredentials = z.infer<typeof ibkrCredentialsSchema>;

// Flex errors that no retry passes: the token expired, the request came from
// an IP the token does not take, the query is not the token's, the token is
// invalid, or the request is.
const REJECTED_CODES = new Set(["1012", "1013", "1014", "1015", "1020"]);

// How long a statement may take to be generated: IBKR answers 1019 while it
// is, and Plant asks again after a wait that grows, within the read's budget.
const STATEMENT_WAITS_MS = [2000, 3000, 5000, 5000, 10000];

// The most wall time one read takes, requests and waits included, well
// under the function's limit: past it the read fails for a later attempt,
// which the job retries with its own backoff.
export const IBKR_READ_BUDGET_MS = 30_000;

// The largest statement Plant downloads: a year of a retail account's
// positions and trades is far smaller.
const STATEMENT_MAX_BYTES = 20_000_000;

// The draft's currency, or null for one Plant does not keep.
const currencyOf = (code: string | undefined): "ARS" | "USD" | null =>
  code === "USD" ? "USD" : code === "ARS" ? "ARS" : null;

const SYMBOL = /^[A-Za-z0-9. /-]{1,30}$/;

// A Flex date (yyyyMMdd, yyyy-MM-dd, or either with a time after a `;`)
// as an ISO date, or null.
function isoDate(text: string | undefined): string | null {
  const day = (text ?? "").split(/[;, ]/)[0] ?? "";
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(day);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const absolute = (value: string | null) =>
  value === null ? null : value.replace(/^-/, "");

// A row Plant keeps the most detailed level of only, so lots or orders do
// not count twice: what has no level, or the one asked for.
const atLevel = (row: Record<string, string>, level: string) =>
  row.levelOfDetail === undefined || row.levelOfDetail.toUpperCase() === level;

// Interactive Brokers through the Flex Web Service: a Flex token only runs
// the user's Flex queries, so it cannot trade. Plant asks for the query's
// statement (SendRequest), then fetches it (GetStatement), waiting while
// IBKR generates it.
export function ibkrConnection({
  baseUrl = IBKR_FLEX_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  sleep = defaultSleep,
  timeoutMs = 10_000,
  budgetMs = IBKR_READ_BUDGET_MS,
  clock = () => performance.now(),
}: ConnectionDeps = {}) {
  const budget = budgetedRead({ timeoutMs, budgetMs, clock, sleep });
  const flex = async (path: string, query: Record<string, string>) => {
    const response = await call(
      get,
      `${baseUrl}/${path}?${new URLSearchParams({ ...query, v: "3" })}`,
      { headers: { "User-Agent": "Plant/1.0", Accept: "application/xml" } },
      budget.requestTimeout(),
    );
    if (!response.ok) throw unavailable();
    return bodyText(response, STATEMENT_MAX_BYTES);
  };

  const failureOf = (xml: string) => {
    const code = textOf(xml, "ErrorCode") ?? "";
    return REJECTED_CODES.has(code) ? rejected() : unavailable();
  };

  // The reference of the statement IBKR is generating for the query.
  const request = async ({ token, queryId }: IbkrCredentials) => {
    const xml = await flex("SendRequest", { t: token, q: queryId });
    const reference = textOf(xml, "ReferenceCode");
    if (textOf(xml, "Status") === "Success" && reference) return reference;
    throw failureOf(xml);
  };

  const statement = async (credentials: IbkrCredentials) => {
    budget.start();
    const reference = await request(credentials);
    const xml = await budget.poll([0, ...STATEMENT_WAITS_MS], async () => {
      const answer = await flex("GetStatement", {
        t: credentials.token,
        q: reference,
      });
      if (answer.includes("<FlexQueryResponse")) return answer;
      // 1019: still generating; 1018: too many requests for now.
      const code = textOf(answer, "ErrorCode");
      if (code !== "1019" && code !== "1018") throw failureOf(answer);
      return undefined;
    });
    if (xml === undefined) throw unavailable();
    return xml;
  };

  const holdings = (xml: string) => {
    const rows: DraftRow[] = [];
    let skipped = 0;
    for (const each of elements(xml, "OpenPosition")) {
      if (!atLevel(each, "SUMMARY")) continue;
      const quantity = decimalOf(each.position);
      const currency = currencyOf(each.currency);
      const symbol = each.symbol?.trim() ?? "";
      if (!positive(quantity) || currency === null || !SYMBOL.test(symbol)) {
        skipped += 1;
        continue;
      }
      const price = decimalOf(each.markPrice);
      const value = absolute(decimalOf(each.positionValue));
      const cost = decimalOf(each.costBasisPrice);
      rows.push({
        symbol,
        quantity,
        price: positive(price) ? price : null,
        value: positive(value) ? value : null,
        ...(positive(cost) && { cost }),
        currency,
        confidence: "high",
        page: null,
      });
    }
    // Cash by currency, at the statement's end; the base currency's summary
    // repeats the others. A currency reported more than once is added up.
    const cash: { currency: Currency; amount: string }[] = [];
    for (const each of elements(xml, "CashReportCurrency")) {
      if (each.currency === "BASE_SUMMARY") continue;
      const currency = currencyOf(each.currency);
      const amount = decimalOf(each.endingCash);
      if (isZero(amount)) continue;
      if (currency === null || amount === null) {
        skipped += 1;
        continue;
      }
      cash.push({ currency, amount });
    }
    const summed = summedCashRows(cash, "high");
    rows.push(...summed.rows);
    const reading = holdingsReading(rows, skipped + summed.skipped, now());
    const toDate = isoDate(elements(xml, "FlexStatement")[0]?.toDate);
    if (toDate) reading.draft.documentDate = toDate;
    return reading;
  };

  const operations = (xml: string) => {
    const found: DraftOperation[] = [];
    let skipped = 0;
    for (const each of elements(xml, "Trade")) {
      if (!atLevel(each, "EXECUTION")) continue;
      const side = each.buySell?.toUpperCase();
      const quantity = absolute(decimalOf(each.quantity));
      const currency = currencyOf(each.currency);
      const symbol = each.symbol?.trim() ?? "";
      if (
        (side !== "BUY" && side !== "SELL") ||
        !positive(quantity) ||
        currency === null ||
        !SYMBOL.test(symbol)
      ) {
        skipped += 1;
        continue;
      }
      const price = decimalOf(each.tradePrice);
      const amount = absolute(decimalOf(each.proceeds));
      const charges = absolute(decimalOf(each.ibCommission));
      found.push({
        date: isoDate(each.tradeDate ?? each.dateTime),
        kind: side === "BUY" ? "purchase" : "sale",
        symbol,
        quantity,
        price: positive(price) ? price : null,
        amount: positive(amount) ? amount : null,
        charges,
        reference: (each.tradeID ?? "").slice(0, 40) || null,
        currency,
        confidence: "high",
        page: null,
      });
    }
    for (const each of elements(xml, "CashTransaction")) {
      if (each.type !== "Dividends" || !atLevel(each, "DETAIL")) continue;
      const amount = decimalOf(each.amount);
      const currency = currencyOf(each.currency);
      const symbol = each.symbol?.trim() ?? "";
      if (!positive(amount) || currency === null || !SYMBOL.test(symbol)) {
        skipped += 1;
        continue;
      }
      found.push({
        date: isoDate(each.dateTime ?? each.settleDate ?? each.reportDate),
        kind: "dividend",
        symbol,
        quantity: null,
        price: null,
        amount,
        charges: null,
        reference: (each.transactionID ?? "").slice(0, 40) || null,
        currency,
        confidence: "high",
        page: null,
      });
    }
    return operationsReading(found, skipped);
  };

  return defineConnection({
    provider: "ibkr",
    credentials: ibkrCredentialsSchema,
    secrets: ["token"],
    hintField: "queryId",
    readOnly: "inherent",
    drafts: ["holdings", "operations"],
    // A statement requested proves the token runs the query.
    check: async (credentials) => {
      budget.start();
      await request(credentials);
    },
    async read(credentials, draft) {
      const xml = await statement(credentials);
      return draft === "holdings" ? holdings(xml) : operations(xml);
    },
  });
}
