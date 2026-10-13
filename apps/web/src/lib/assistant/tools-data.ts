import "server-only";
import {
  DENOMINATORS,
  type QuoteSnapshot,
  rate,
  valueLiabilities,
} from "@plant/core";
import {
  compareDecimals,
  type Database,
  exactOf,
  neutralizePromptText,
  times,
  toDecimal,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { percentOf } from "@/lib/format/amount";
import { HOLDING_CLASS_GROUP_LABELS } from "@/lib/holdings/classes";
import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import { readReferenceDollar } from "@/lib/holdings/read";
import type { Sum } from "@/lib/holdings/valuation-view";
import type { ReadContext } from "@/lib/portfolio-setup/read";
import { monthOf } from "@/lib/summary/closes";
import { closesOf, yearsOfCloses } from "@/lib/summary/compute";
import { type ClosesRead, readCloses } from "@/lib/summary/read";
import { pricedToday, summaryValuation } from "@/lib/summary/valuation";

import type { AnswerMetadata, ChatUnit } from "./chat";
import { rateOf, SOURCES, worthOfAssets } from "./figures";

// The most holdings one answer lists.
const HOLDINGS_LISTED = 30;

// What every result says about itself, as an answer does, and which reads
// were cut short.
type Meta = AnswerMetadata & {
  truncated: { holdings: boolean; debts: boolean; ledger: boolean };
};

export type ToolFailure = { error: "read_failed" | "unknown_portfolio" };

// A name the user or a document wrote, before it reaches a model.
const named = (text: string) => neutralizePromptText(text).slice(0, 80);

// The data the assistant's tools answer from, for one user and one
// conversation's unit. Everything is read once per turn, on the first tool
// that needs it, the way Resumen reads it, through the session's client:
// RLS keeps the reads to the user's rows.
export function assistantData({
  client,
  context,
  unit,
  today,
}: {
  client: SupabaseClient<Database>;
  context: ReadContext;
  unit: ChatUnit;
  today: string;
}) {
  let loaded: Promise<ClosesRead> | undefined;
  const load = () =>
    (loaded ??= readReferenceDollar(client, context).then((referenceDollar) =>
      readCloses(client, context, { today, referenceDollar }),
    ));

  const metaOf = (
    read: ClosesRead,
    snapshot: QuoteSnapshot,
    sources: string[],
    complete: boolean,
  ): Meta => ({
    sources,
    asOf: today,
    rate: rateOf(unit, snapshot),
    complete,
    truncated: {
      holdings: read.holdings.activeTruncated,
      debts: read.debtsTruncated,
      ledger: read.ledgerTruncated,
    },
  });

  // A portfolio named by the model: its id or its name, among the user's.
  const portfolioOf = (read: ClosesRead, wanted: string | undefined) => {
    if (wanted === undefined) return null;
    const key = wanted.trim().toLowerCase();
    return read.state.portfolios.find(
      (each) => each.id === wanted || each.name.toLowerCase() === key,
    );
  };

  const unknownPortfolio = (read: ClosesRead) => ({
    error: "unknown_portfolio" as const,
    portfolios: read.state.portfolios.map((each) => named(each.name)),
  });

  const shares = (sums: Partial<Record<string, Sum>>) =>
    Object.entries(sums)
      .flatMap(([key, sum]) =>
        sum ? [{ key, value: sum.value, share: sum.share }] : [],
      )
      .sort((a, b) => compareDecimals(b.value, a.value));

  return {
    // Net worth today as Resumen shows it: assets, debts and what is left;
    // with a portfolio, that portfolio's assets only, as debts and closes
    // are of the whole.
    async portfolioSummary(portfolio?: string) {
      const read = await load();
      const snapshot = pricedToday(read);
      const chosen = portfolioOf(read, portfolio);
      if (chosen === undefined) return unknownPortfolio(read);
      if (chosen) {
        const { valuation } = summaryValuation(read, {
          unit,
          portfolioId: chosen.id,
        });
        return {
          ...metaOf(
            read,
            snapshot,
            [SOURCES.holdings, SOURCES.quotes],
            valuation.kinds.total.complete,
          ),
          unit,
          portfolio: named(chosen.name),
          assets: valuation.kinds.total.value,
          missingPrices: valuation.kinds.total.missing,
          netWorth: null,
          note: "Las deudas y el patrimonio neto son del total, no de una cartera.",
        };
      }
      // The assets of the same valuation listHoldings and allocation answer
      // from, so the tools add up.
      const { valuation } = summaryValuation(read, { unit, portfolioId: null });
      const owed = valueLiabilities(read.state.liabilities, snapshot, {
        denominator: unit,
        referenceDollar: read.state.referenceDollar,
      });
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.holdings, SOURCES.debts, SOURCES.quotes],
          valuation.kinds.total.complete && owed.complete,
        ),
        unit,
        ...worthOfAssets(valuation.kinds.total.value, owed.total),
        missingPrices: valuation.kinds.total.missing,
        debtCount: read.state.liabilities.length,
      };
    },

    // The largest holdings by value, with where each is and its share.
    async listHoldings(portfolio?: string) {
      const read = await load();
      const snapshot = pricedToday(read);
      const chosen = portfolioOf(read, portfolio);
      if (chosen === undefined) return unknownPortfolio(read);
      const { rows, valuation } = summaryValuation(read, {
        unit,
        portfolioId: chosen?.id ?? null,
      });
      const names = instrumentNames(read.state.instruments);
      const listed = rows
        .map((row) => ({ row, value: valuation.values[row.id] }))
        .sort((a, b) =>
          compareDecimals(b.value?.value ?? "0", a.value?.value ?? "0"),
        );
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.holdings, SOURCES.quotes],
          valuation.kinds.total.complete,
        ),
        unit,
        total: listed.length,
        shown: Math.min(listed.length, HOLDINGS_LISTED),
        holdings: listed.slice(0, HOLDINGS_LISTED).map(({ row, value }) => ({
          name: named(holdingName(row.holding, names)),
          account: named(row.account.institution),
          portfolio: named(row.portfolio.name),
          value: value?.value ?? null,
          share: value?.share ?? null,
        })),
      };
    },

    // How the assets are split: by kind of asset, by currency and by
    // account, each with its share.
    async allocation(portfolio?: string) {
      const read = await load();
      const snapshot = pricedToday(read);
      const chosen = portfolioOf(read, portfolio);
      if (chosen === undefined) return unknownPortfolio(read);
      const { rows, valuation } = summaryValuation(read, {
        unit,
        portfolioId: chosen?.id ?? null,
      });
      const accounts = new Map(
        rows.map((row) => [row.account.id, row.account.institution]),
      );
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.holdings, SOURCES.quotes],
          valuation.kinds.total.complete,
        ),
        unit,
        total: valuation.kinds.total.value,
        byKind: shares(valuation.classes).map(({ key, value, share }) => ({
          kind: HOLDING_CLASS_GROUP_LABELS[
            key as keyof typeof HOLDING_CLASS_GROUP_LABELS
          ],
          value,
          share,
        })),
        byCurrency: shares(valuation.currencies).map(
          ({ key, value, share }) => ({ currency: key, value, share }),
        ),
        byAccount: Object.entries(valuation.accounts)
          .map(([id, sum]) => ({
            account: named(accounts.get(id) ?? ""),
            value: sum.total.value,
            share: sum.total.share,
          }))
          .sort((a, b) => compareDecimals(b.value, a.value)),
      };
    },

    // Net worth at the end of each of the last 12 months, and this year's
    // result: what it gained, what was put in and the income collected.
    async netWorthHistory() {
      const read = await load();
      const snapshot = pricedToday(read);
      const closes = closesOf(read.state, unit);
      const [year] = yearsOfCloses(closes);
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.closes, SOURCES.quotes],
          closes.slice(-12).every((month) => month.endComplete),
        ),
        unit,
        months: closes.slice(-12).map((month) => ({
          month: `${monthOf(month.period)} ${month.period.slice(0, 4)}`,
          endValue: month.figures.endValue,
          result: month.figures.result,
        })),
        thisYear: year
          ? {
              year: year.year,
              result: year.totals.result,
              contributed: year.totals.contributed,
              income: year.totals.income,
              // A percent, as every other tool's share.
              share:
                year.totals.share === null
                  ? null
                  : percentOf(year.totals.share),
              complete: year.complete,
            }
          : null,
      };
    },

    // An amount in one unit in another, at today's quotes.
    async convertCurrency({
      amount,
      from,
      to,
    }: {
      amount: string;
      from: ChatUnit;
      to: ChatUnit;
    }) {
      const read = await load();
      const snapshot = pricedToday(read);
      const perUnit = rate(from, to, snapshot);
      const meta = metaOf(read, snapshot, [SOURCES.quotes], true);
      if ("missing" in perUnit) return { ...meta, complete: false, to };
      return {
        ...meta,
        rate: rateOf(to === "ars" ? from : to, snapshot),
        amount,
        from,
        to,
        converted: toDecimal(
          times(exactOf(amount), perUnit.amount),
          DENOMINATORS[to].scale,
        ),
      };
    },
  };
}

export type AssistantData = ReturnType<typeof assistantData>;
