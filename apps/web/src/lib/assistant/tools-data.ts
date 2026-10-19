import "server-only";
import type { ChartTopic } from "./chat";
import {
  DENOMINATORS,
  type InstrumentType,
  isOwed,
  type QuoteSnapshot,
  quotedPrice,
  rate,
  valueLiabilities,
} from "@plant/core";
import {
  compareDecimals,
  type Database,
  exactOf,
  minus,
  neutralizePromptText,
  plus,
  stored,
  times,
  toDecimal,
  ZERO,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { LIABILITY_KIND_LABELS } from "@/lib/debts/labels";
import { exactPercentOf, percentOf } from "@/lib/format/amount";
import { HOLDING_CLASS_GROUP_LABELS } from "@/lib/holdings/classes";
import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import { MOVEMENT_KIND_LABELS } from "@/lib/holdings/messages";
import { priceBasisLabel } from "@/lib/holdings/price-input";
import { readReferenceDollar } from "@/lib/holdings/read";
import type { Sum } from "@/lib/holdings/valuation-view";
import { readImports } from "@/lib/imports/read";
import { IMPORT_STATUS_LABELS, IMPORTS_PER_MONTH } from "@/lib/imports/review";
import { allRows } from "@/lib/ledger/ledger";
import type { ReadContext } from "@/lib/portfolio-setup/read";
import { monthName, monthOf } from "@/lib/summary/closes";
import {
  changeBetween,
  closesOf,
  debtsToday,
  yearsOfCloses,
} from "@/lib/summary/compute";
import { type ClosesRead, readCloses } from "@/lib/summary/read";
import { pricedToday, summaryValuation } from "@/lib/summary/valuation";

import {
  type AnswerMetadata,
  barsOf,
  type ChatUnit,
  MAX_CHART_POINTS,
} from "./chat";
import { rateOf, SOURCES, worthOfAssets } from "./figures";
import { CALENDAR_DAYS, incomeCalendar } from "./income";
import { changeChart, changePeriod, lastClosed } from "./month-change";
import {
  assumptionsOf,
  scenarioChart,
  pairedScenario,
  priceTarget,
  type ScenarioInput,
  scenarioOf,
  type Shock,
} from "./scenario";

// The most holdings one answer lists.
const HOLDINGS_LISTED = 30;
// The most movements, debts and imports one answer lists.
const MOVEMENTS_LISTED = 30;
const DEBTS_LISTED = 30;
const EVENTS_LISTED = 30;
const IMPORTS_LISTED = 10;

// What every result says about itself, as an answer does, and which reads
// were cut short.
type Meta = AnswerMetadata & {
  truncated: {
    holdings: boolean;
    debts: boolean;
    debtEvents: boolean;
    ledger: boolean;
  };
};

export type ToolFailure = {
  error:
    | "read_failed"
    | "unknown_portfolio"
    | "unknown_instrument"
    | "unknown_month"
    | "no_change"
    | "unpriced_instrument";
};

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
      debtEvents: read.debtEventsTruncated,
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

  // An instrument named by the model: its symbol or its name, in the
  // catalog; null when none matches.
  const symbolOf = (read: ClosesRead, wanted: string) => {
    const key = wanted.trim().toLowerCase();
    return (
      read.state.instruments.find(
        (each) =>
          each.symbol.toLowerCase() === key || each.name.toLowerCase() === key,
      )?.symbol ?? null
    );
  };

  const unknownInstrument = (read: ClosesRead) => ({
    error: "unknown_instrument" as const,
    held: [
      ...new Set(
        read.holdings.active.flatMap((row) =>
          row.holding.asset_class === "instrument"
            ? [row.holding.instrument_symbol]
            : [],
        ),
      ),
    ],
  });

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

  const tools = {
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
      const owed = valueLiabilities(debtsToday(read.state), snapshot, {
        denominator: unit,
        referenceDollar: read.state.referenceDollar,
      });
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.holdings, SOURCES.debts, SOURCES.quotes],
          valuation.kinds.total.complete &&
            owed.complete &&
            !read.debtsTruncated &&
            !read.debtEventsTruncated,
        ),
        unit,
        ...worthOfAssets(valuation.kinds.total.value, owed.total),
        missingPrices: valuation.kinds.total.missing,
        debtCount: debtsToday(read.state).filter(isOwed).length,
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
          // A month's result needs its start, its end and its flows priced,
          // as the closes table marks it.
          closes.slice(-12).every((month) => month.complete) &&
            (year?.complete ?? true),
        ),
        unit,
        months: closes.slice(-12).map((month) => ({
          month: `${monthOf(month.period)} ${month.period.slice(0, 4)}`,
          endValue: month.figures.endValue,
          result: month.figures.result,
          complete: month.complete,
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

    // What the user is expected to collect in the next CALENDAR_DAYS days:
    // dividends and coupons from what each instrument paid before, and the
    // placements that mature, by date and summed by month.
    async incomeEvents() {
      const read = await load();
      const snapshot = pricedToday(read);
      const events = incomeCalendar(read.state, snapshot, unit);
      const byMonth = new Map<string, string>();
      for (const event of events) {
        if (event.value === null) continue;
        const month = event.date.slice(0, 7);
        byMonth.set(
          month,
          stored(
            plus(exactOf(byMonth.get(month) ?? "0"), exactOf(event.value)),
          ),
        );
      }
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.movements, SOURCES.holdings, SOURCES.quotes],
          events.every((event) => event.value !== null) &&
            !read.ledgerTruncated &&
            !read.holdings.activeTruncated,
        ),
        unit,
        days: CALENDAR_DAYS,
        note: "Los dividendos y cupones se estiman con los pagos anteriores de cada tenencia; los plazos fijos son exactos.",
        total: events.length,
        shown: Math.min(events.length, EVENTS_LISTED),
        events: events.slice(0, EVENTS_LISTED).map((event) => ({
          date: event.date,
          kind: INCOME_KINDS[event.kind],
          name: named(event.name),
          value: event.value,
        })),
        byMonth: [...byMonth].map(([month, value]) => ({
          month: `${monthOf(month)} ${month.slice(0, 4)}`,
          value,
        })),
      };
    },

    // The user's debts, each with its balance in the unit, and their total.
    async liabilities() {
      const read = await load();
      const snapshot = pricedToday(read);
      const today = debtsToday(read.state);
      const owed = valueLiabilities(today, snapshot, {
        denominator: unit,
        referenceDollar: read.state.referenceDollar,
      });
      const values = new Map(owed.items.map((item) => [item.id, item.value]));
      const debts = today
        .filter(isOwed)
        .map((debt) => ({ debt, value: values.get(debt.id) ?? null }))
        .sort((a, b) => compareDecimals(b.value ?? "0", a.value ?? "0"));
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.debts, SOURCES.quotes],
          owed.complete && !read.debtsTruncated && !read.debtEventsTruncated,
        ),
        unit,
        total: owed.total,
        count: debts.length,
        debts: debts.slice(0, DEBTS_LISTED).map(({ debt, value }) => ({
          name: named(debt.label),
          kind: LIABILITY_KIND_LABELS[debt.kind],
          lender: debt.lender === null ? null : named(debt.lender),
          uva: debt.uva,
          value,
          annualRate:
            debt.annual_rate === null ? null : exactPercentOf(debt.annual_rate),
          accrues: debt.accrues,
          installment: debt.installment,
          installmentCurrency: debt.uva
            ? "UVA"
            : (debt.currency ?? debt.instrument_symbol),
          installmentsLeft: debt.installments_left,
          nextDueOn: debt.next_due_on,
          maturesOn: debt.matures_on,
        })),
      };
    },

    // The latest movements, newest first, of one instrument or of all, each
    // with its account and portfolio. Amounts are in the movement's own
    // currency, as the user typed or imported them.
    async transactions(instrument?: string) {
      const read = await load();
      const snapshot = pricedToday(read);
      const symbol = instrument && symbolOf(read, instrument);
      if (symbol === null) return unknownInstrument(read);
      const names = instrumentNames(read.state.instruments);
      const types = new Map(
        read.state.instruments.map((each) => [each.symbol, each.type]),
      );
      const listed = allRows(read.state)
        .filter(
          (row) =>
            row.holding.asset_class === "instrument" &&
            (symbol === undefined || row.holding.instrument_symbol === symbol),
        )
        .flatMap((row) =>
          (read.state.movements.get(row.id) ?? []).map((movement) => ({
            row,
            movement,
          })),
        )
        .sort(
          (a, b) =>
            b.movement.date.localeCompare(a.movement.date) ||
            b.movement.entry_order - a.movement.entry_order,
        );
      return {
        ...metaOf(read, snapshot, [SOURCES.movements], !read.ledgerTruncated),
        total: listed.length,
        shown: Math.min(listed.length, MOVEMENTS_LISTED),
        movements: listed
          .slice(0, MOVEMENTS_LISTED)
          .map(({ row, movement }) => ({
            date: movement.date,
            kind: MOVEMENT_KIND_LABELS[movement.kind],
            direction: "direction" in movement ? movement.direction : null,
            instrument: named(holdingName(row.holding, names)),
            account: named(row.account.institution),
            portfolio: named(row.portfolio.name),
            currency: movement.currency,
            quantity: "quantity" in movement ? movement.quantity : null,
            ...asQuoted(
              "price" in movement ? movement.price : null,
              row.holding.asset_class === "instrument"
                ? types.get(row.holding.instrument_symbol)
                : undefined,
            ),
            amount: "amount" in movement ? movement.amount : null,
          })),
      };
    },

    // One instrument: what it is, today's price in the unit, and how much the
    // user holds of it, where.
    async assetInfo(instrument: string) {
      const read = await load();
      const snapshot = pricedToday(read);
      const symbol = symbolOf(read, instrument);
      if (symbol === null) return unknownInstrument(read);
      const found = read.state.instruments.find(
        (each) => each.symbol === symbol,
      )!;
      const { rows, valuation } = summaryValuation(read, {
        unit,
        portfolioId: null,
      });
      const held = rows.filter(
        (row) =>
          row.holding.asset_class === "instrument" &&
          row.holding.instrument_symbol === symbol,
      );
      const price = held
        .map((row) => valuation.values[row.id]?.price ?? null)
        .find((each) => each !== null);
      const sums = held.map((row) => valuation.values[row.id]?.value ?? null);
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.holdings, SOURCES.quotes],
          sums.every((each) => each !== null) && !read.holdings.activeTruncated,
        ),
        unit,
        symbol,
        name: named(found.name),
        type: found.type,
        // What the market quotes it in; price and value are in the unit.
        quotedIn: found.currency,
        ...asQuoted(price ?? null, found.type),
        quantity: stored(
          held.reduce(
            (sum, row) => plus(sum, exactOf(row.holding.amount)),
            ZERO,
          ),
        ),
        value: sums.every((each) => each !== null)
          ? stored(sums.reduce((sum, each) => plus(sum, exactOf(each!)), ZERO))
          : null,
        holdings: held.map((row) => ({
          account: named(row.account.institution),
          portfolio: named(row.portfolio.name),
          quantity: row.holding.amount,
          value: valuation.values[row.id]?.value ?? null,
        })),
      };
    },

    // Net worth today and under a hypothetical move of a dollar or of prices,
    // computed here at today's quotes with only the named ones moved.
    async scenario(input: ScenarioInput) {
      const { dollar, dollarChange, instrument, priceChange } = input;
      if (!pairedScenario(input)) return { error: "no_change" as const };
      const read = await load();
      const snapshot = pricedToday(read);
      const holdings = read.holdings.active.map((row) => row.holding);
      const symbol = instrument ? symbolOf(read, instrument) : null;
      if (symbol === null && instrument) return unknownInstrument(read);
      if (symbol !== null) {
        const target = priceTarget(holdings, snapshot, symbol);
        if (target === "not_held") return unknownInstrument(read);
        if (target === "unpriced") {
          return { error: "unpriced_instrument" as const, symbol };
        }
      }
      const shock: Shock = {
        ...(dollarChange !== undefined && {
          dollar: { kind: dollar ?? "all", change: dollarChange },
        }),
        ...(priceChange !== undefined && {
          price: { symbol, change: priceChange },
        }),
      };
      const name =
        symbol === null
          ? null
          : read.state.instruments.find((each) => each.symbol === symbol)!.name;
      const outcome = scenarioOf({
        holdings,
        liabilities: debtsToday(read.state),
        snapshot,
        unit,
        referenceDollar: read.state.referenceDollar,
        shock,
      });
      const said = assumptionsOf(shock, name === null ? null : named(name));
      const parts = (["dollar", "price"] as const).filter((part) => said[part]);
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.holdings, SOURCES.debts, SOURCES.quotes],
          outcome.complete,
        ),
        unit,
        hypothetical: true,
        label: "Escenario hipotético",
        assumptions: parts
          .filter((part) => !outcome.idle.includes(part))
          .map((part) => said[part]!),
        // What the user asked about that moves nothing they hold or owe.
        changesNothing: outcome.idle.map((part) => said[part]!),
        note: "Es un cálculo hipotético, no una predicción: mueve solo lo indicado y deja el resto de las cotizaciones y precios como están hoy (un CEDEAR en pesos no sigue al dólar). Lo que está en changesNothing no cambia nada de lo que tiene o debe: decilo así, no como un movimiento.",
        today: outcome.today,
        scenario: outcome.scenario,
        change: outcome.change,
        share: outcome.share === null ? null : percentOf(outcome.share),
        missingPrices: outcome.missing,
        chart: scenarioChart(outcome, unit),
      };
    },

    // A month's close, or several months' together, and where net worth's
    // change came from: what was put in, prices, the dollar, yields and the
    // debts' interest.
    async monthSummary({ from, to }: { from?: string; to?: string }) {
      const read = await load();
      const snapshot = pricedToday(read);
      const closes = closesOf(read.state, unit);
      const last = lastClosed(closes);
      const first = from ?? to ?? last;
      const change =
        first === undefined
          ? null
          : changeBetween(read.state, unit, first, to ?? first);
      if (change === null) {
        return {
          error: "unknown_month" as const,
          firstMonth: closes[0] ? monthName(closes[0].period) : null,
          lastMonth: closes.at(-1) ? monthName(closes.at(-1)!.period) : null,
        };
      }
      const fraction = (value: string | null) =>
        value === null ? null : percentOf(value);
      return {
        ...metaOf(
          read,
          snapshot,
          [SOURCES.closes, SOURCES.movements, SOURCES.quotes],
          change.complete,
        ),
        unit,
        period: changePeriod(change),
        months: change.months,
        inProgress: change.open,
        startValue: change.startValue,
        endValue: change.endValue,
        change: stored(
          minus(exactOf(change.endValue), exactOf(change.startValue)),
        ),
        // The change, part by part: they add up to it.
        breakdown: {
          contributed: change.contributed,
          prices: change.prices,
          dollar: change.dollar,
          yields: change.yields,
          kept: change.kept,
          interest: change.interest,
        },
        result: change.result,
        income: change.income,
        charges: change.charges,
        realized: change.realized,
        share: fraction(change.share),
        inflation: fraction(change.benchmarks.inflation),
        dollarMove: fraction(change.benchmarks.dollar),
        note: "contributed es lo que puso neto (negativo si sacó plata o tomó deuda nueva; no distingas entre las dos); prices y dollar, lo que hicieron los precios y el dólar con lo que tenía; yields, lo que sumaron los rendimientos que se suman a la tenencia; kept, lo que dejaron en su efectivo las operaciones pagadas o cobradas con él (dividendos menos comisiones y gastos); interest, lo que costaron los intereses de sus deudas (negativo; positivo cuando un acreedor corrigió una deuda a la baja, y entonces es una corrección). Pagar una deuda con efectivo que el pago descontó de una tenencia no cambia el patrimonio; cualquier otro pago cuenta en contributed. income son los dividendos, cupones y rentas que cobró aparte, antes de retenciones, sin contar yields; charges, comisiones, impuestos e intereses de deudas (interest ya está adentro). share es el rendimiento sin contar lo que puso; inflation y dollarMove, cuánto subieron la inflación y el dólar MEP en el mismo período.",
        chart: changeChart(change, unit),
      };
    },

    // The user's latest imports and how many they started this month.
    async importStatus() {
      const { items, truncated, used } = await readImports(client);
      return {
        sources: [SOURCES.imports],
        asOf: today,
        rate: null,
        complete: !truncated,
        total: items.length,
        shown: Math.min(items.length, IMPORTS_LISTED),
        usedThisMonth: used,
        monthlyLimit: IMPORTS_PER_MONTH,
        imports: items.slice(0, IMPORTS_LISTED).map((item) => ({
          file: named(item.fileName),
          status: IMPORT_STATUS_LABELS[item.status],
          problem: item.error,
          documentDate: item.documentDate,
          uploadedOn: item.createdOn,
        })),
      };
    },
  };

  // A chart of one of the tools' figures, drawn on the server: its numbers
  // are the tool's, never the model's. The model gets the chart's points to
  // comment on; the answer keeps the chart.
  async function chart(kind: ChartTopic, portfolio?: string) {
    const drawn = await chartOf(kind, portfolio);
    if ("error" in drawn) return drawn;
    const { meta, chart } = drawn;
    // Which chart it is, so it can be pinned and drawn again: a portfolio
    // only splits allocation and holdings.
    const of =
      kind === "allocation" || kind === "holdings"
        ? (portfolioOf(await load(), portfolio)?.id ?? null)
        : null;
    return {
      ...meta,
      unit,
      chart: {
        ...chart,
        source: { topic: kind, portfolioId: of },
        title: Array.from(chart.title).slice(0, 60).join(""),
        points: chart.points
          .slice(0, MAX_CHART_POINTS)
          // By code point, so a cut never splits a character in two.
          .map((point) => ({
            ...point,
            label: Array.from(point.label).slice(0, 30).join(""),
          })),
      },
    };
  }

  async function chartOf(kind: ChartTopic, portfolio?: string) {
    const meta = <M extends Meta>(result: M): Meta => ({
      sources: result.sources,
      asOf: result.asOf,
      rate: result.rate,
      complete: result.complete,
      truncated: result.truncated,
    });
    if (kind === "net_worth") {
      const history = await tools.netWorthHistory();
      return {
        meta: meta(history),
        chart: {
          kind: "line" as const,
          template: "net_worth" as const,
          title: "Patrimonio neto al cierre de cada mes",
          unit,
          points: history.months.map((month) => ({
            label: month.month,
            value: month.endValue,
          })),
        },
      };
    }
    if (kind === "allocation") {
      const split = await tools.allocation(portfolio);
      if ("error" in split) return split;
      return {
        meta: meta(split),
        chart: barsOf(
          "distribution",
          "Cómo están repartidos tus activos",
          unit,
          split.byKind.map((each) => ({ label: each.kind, value: each.value })),
        ),
      };
    }
    if (kind === "holdings") {
      const listed = await tools.listHoldings(portfolio);
      if ("error" in listed) return listed;
      return {
        meta: meta(listed),
        chart: barsOf(
          "ranking",
          "Tus tenencias más grandes",
          unit,
          listed.holdings.flatMap((each) =>
            each.value === null
              ? []
              : [{ label: each.name, value: each.value }],
          ),
        ),
      };
    }
    if (kind === "income") {
      const income = await tools.incomeEvents();
      return {
        meta: meta(income),
        chart: barsOf(
          "income",
          "Lo que esperás cobrar por mes",
          unit,
          income.byMonth.map((month) => ({
            label: month.month,
            value: month.value,
          })),
        ),
      };
    }
    const owed = await tools.liabilities();
    return {
      meta: meta(owed),
      chart: barsOf(
        "debts",
        "Lo que debés",
        unit,
        owed.debts.flatMap((each) =>
          each.value === null ? [] : [{ label: each.name, value: each.value }],
        ),
      ),
    };
  }

  return { ...tools, chart };
}

export { CHART_TOPICS, type ChartTopic } from "./chat";

// A unit's price as the market quotes it and the app shows it: a bond's per
// 100 nominal.
const asQuoted = (
  perUnit: string | null,
  type: InstrumentType | undefined,
) => ({
  price: perUnit === null || !type ? perUnit : quotedPrice(type, perUnit),
  priceBasis: type ? priceBasisLabel(type) : "por unidad",
});

const INCOME_KINDS = {
  dividend: "Dividendo",
  coupon: "Cupón",
  maturity: "Vencimiento de plazo fijo",
} as const;

export type AssistantData = ReturnType<typeof assistantData>;
