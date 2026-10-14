import { type QuoteSnapshot, valueLiabilities } from "@plant/core";
import { compareDecimals, exactOf, minus, plus, stored } from "@plant/shared";

import {
  formatAmount,
  formatFraction,
  formatShare,
  percentOf,
  shownAmount,
  shownSign,
  signed,
} from "@/lib/format/amount";
import { countOf, folded } from "@/lib/format/text";
import { ADVICE_ANSWER, isAdvice } from "@/lib/assistant/advice";
import { netWorthOf, rateOf, SOURCES } from "@/lib/assistant/figures";
import {
  type AssistantMessage,
  barsOf,
  type ChatUnit,
  type Conversation,
  titleOf,
} from "@/lib/assistant/chat";
import {
  HOLDING_CLASS_GROUP_LABELS,
  type HoldingClass,
} from "@/lib/holdings/classes";
import { instrumentSummary } from "@/lib/holdings/instrument-history";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import { monthName, monthOf } from "@/lib/summary/closes";

import { closesOf, yearsOfCloses } from "@/lib/summary/compute";
import {
  CALENDAR_DAYS,
  type IncomeEvent,
  incomeCalendar,
} from "@/lib/assistant/income";
import {
  holdingsView,
  instrumentHoldings,
  type PrototypeState,
} from "./prototype-store";

type Answer = Omit<AssistantMessage, "id">;

// Where a result comes from, bar by bar: what is left once sales (net of
// their charges), income and the units held are counted is what purchases'
// charges and withholding took, so the bars add up to the result.
function resultBars(
  result: string,
  unit: ChatUnit,
  bars: { label: string; value: string }[],
): { label: string; value: string }[] {
  const rest = stored(
    minus(exactOf(result), plus(...bars.map(({ value }) => exactOf(value)))),
  );
  return shownSign(rest, unit) === 0
    ? bars
    : [...bars, { label: "Gastos y retenciones", value: rest }];
}

// Text with only its letters and digits.
const compact = (text: string) => text.replace(/[^a-z0-9]/g, "");

// Whether consecutive whole words of a question spell `name` once joined, so
// "Mercado Libre" finds "MercadoLibre" and "Coca Cola" finds "Coca-Cola",
// while "antes la" never finds "Tesla".
const namesIn = (words: readonly string[], name: string) => {
  const wanted = compact(folded(name));
  return words.some((_, start) => {
    let joined = "";
    for (const word of words.slice(start)) {
      joined += word;
      if (joined === wanted) return true;
      if (joined.length >= wanted.length) return false;
    }
    return false;
  });
};

// What an answer about a year that left something out adds.
const PARTIAL_YEAR = " Al año le falta algún dato; mirá su cierre.";

// A figure in words by the sign it shows with: `down` or `up` given its
// unsigned size ("perdió US$ 10", "ganó US$ 10"), or `even` when it shows as
// zero.
type Wording = {
  down: (size: string) => string;
  up: (size: string) => string;
  even: string;
};

const worded = (shown: string, size: string, words: Wording) => {
  const { n } = exactOf(shown);
  if (n === 0n) return words.even;
  return n < 0n ? words.down(size) : words.up(size);
};

// A return, as its percent shows.
const byShare = (share: string, words: Wording) => {
  const percent = percentOf(share);
  return worded(percent, formatShare(percent.replace(/^-/, "")), words);
};

// What a figure that left something out says after it.
const WITHOUT_PRICE = " (sin contar lo que no tiene cotización)";

// An amount, as it shows in the unit.
const bySign = (amount: string, unit: ChatUnit, words: Wording) => {
  const shown = shownAmount(amount, unit);
  return worded(shown, formatAmount(shown.replace(/^-/, ""), unit), words);
};

const moved = (amount: string, unit: ChatUnit) =>
  bySign(amount, unit, {
    down: (size) => `perdió ${size}`,
    up: (size) => `ganó ${size}`,
    even: "no ganó ni perdió",
  });

// A question about what is coming in: "¿qué cobro este mes?", "¿cuándo
// cobro?", "¿qué voy a cobrar?", "próximos cobros", "calendario de cobros".
const CALENDAR =
  /(que|cuanto|cuando) cobro\b|voy a cobrar|proxim\w* (cobro|pago|dividendo|cupon)|calendario|por cobrar/;

const EVENT_KINDS: Record<IncomeEvent["kind"], string> = {
  dividend: "Dividendo",
  coupon: "Cupón",
  maturity: "Vencimiento",
};

// What comes in over the next days: this month's sum, the whole window's,
// a table of each payment and a chart by month.
function calendarAnswer(
  state: PrototypeState,
  snapshot: QuoteSnapshot,
  unit: ChatUnit,
  base: Pick<Answer, "role" | "asOf" | "rate">,
): Answer {
  const events = incomeCalendar(state, snapshot, unit);
  const sources = [SOURCES.movements, SOURCES.holdings, SOURCES.quotes];
  if (events.length === 0) {
    return {
      ...base,
      text: `No esperás cobros en los próximos ${CALENDAR_DAYS} días: ningún activo tuyo viene pagando dividendos o cupones, ni vence una colocación.`,
      charts: [],
      table: null,
      sources,
    };
  }
  const month = state.today.slice(0, 7);
  const sum = (some: readonly IncomeEvent[]) =>
    stored(plus(...some.map((each) => exactOf(each.value ?? "0"))));
  const complete = events.every((each) => each.value !== null);
  const thisMonth = events.filter((each) => each.date.startsWith(month));
  const months = [...new Set(events.map((each) => each.date.slice(0, 7)))];
  return {
    ...base,
    text: `${
      thisMonth.length === 0
        ? "Este mes no esperás cobros."
        : `Este mes esperás cobrar ${formatAmount(sum(thisMonth), unit)} en ${countOf(thisMonth.length, "pago", "pagos")}.`
    } En los próximos ${CALENDAR_DAYS} días, ${formatAmount(sum(events), unit)}${complete ? "" : WITHOUT_PRICE}. Los dividendos y cupones son una estimación por lo que pagó cada activo antes; los vencimientos incluyen el capital.`,
    charts: [
      barsOf(
        "income",
        "Cobros por mes",
        unit,
        months.map((each) => ({
          label: monthName(each),
          value: sum(events.filter((event) => event.date.startsWith(each))),
        })),
      ),
    ],
    table: {
      title: `Próximos ${CALENDAR_DAYS} días`,
      unit,
      rows: events.map((each) => ({
        date: each.date,
        label: `${EVENT_KINDS[each.kind]} · ${each.name}`,
        value: each.value,
      })),
    },
    sources,
  };
}

// What the assistant would answer, standing in for the model: it picks what
// the question is about and builds the answer from the user's own data, its
// figures and its chart computed here, never written by a model. A question
// about what to buy or sell gets the fixed answer.
export function prototypeAnswer(
  state: PrototypeState,
  question: string,
  unit: ChatUnit,
  snapshot: QuoteSnapshot,
): Answer {
  const asked = folded(question);
  const words = asked.split(/[^a-z0-9]+/);
  const base = {
    role: "assistant" as const,
    asOf: state.today,
    rate: rateOf(unit, snapshot),
    table: null,
  };

  if (isAdvice(question)) {
    return { ...base, text: ADVICE_ANSWER, charts: [], sources: [] };
  }

  const instrument = state.instruments.find(
    (each) => words.includes(folded(each.symbol)) || namesIn(words, each.name),
  );
  if (instrument) {
    const { holdings, flows, value } = instrumentHoldings(
      state,
      instrument.symbol,
      unit,
      snapshot,
    );
    if (holdings.length === 0) {
      return {
        ...base,
        text: `No tenés ni tuviste ${instrument.name} en Plant.`,
        charts: [],
        sources: [SOURCES.holdings],
      };
    }
    const summary = instrumentSummary(holdings, flows, state.today, value);
    const returns = summary.returns;
    const held = exactOf(summary.quantity).n !== 0n;
    return {
      ...base,
      text: [
        !held
          ? `Ya no tenés ${instrument.symbol}.`
          : `Hoy tenés ${instrument.symbol} por ${summary.value ? formatAmount(summary.value, unit) : "un valor sin cotización"}.`,
        returns
          ? `En total, entre lo que vendiste${held ? ", lo que cobraste y lo que tenés" : " y lo que cobraste"}, tu inversión ${moved(returns.result, unit)}${returns.share && shownSign(returns.result, unit) !== 0 ? ` (${formatFraction(returns.share.replace(/^-/, ""))} de lo que pusiste)` : ""}.${returns.annual ? ` ${byShare(returns.annual, { down: (size) => `Por año, perdió un ${size}.`, up: (size) => `Por año, rindió un ${size}.`, even: "Por año, no rindió ni perdió." })}` : ""}`
          : "",
        held && summary.unrealized
          ? bySign(summary.unrealized.amount, unit, {
              down: (size) =>
                `Lo que tenés hoy vale ${size} menos de lo que te costó.`,
              up: (size) =>
                `Lo que tenés hoy vale ${size} más de lo que te costó.`,
              even: "Lo que tenés hoy vale lo que te costó.",
            })
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      charts: returns
        ? [
            barsOf(
              "bars",
              `${instrument.symbol}: de dónde sale el resultado`,
              unit,
              resultBars(returns.result, unit, [
                { label: "Realizado", value: summary.realized ?? "0" },
                { label: "Rentas", value: summary.income ?? "0" },
                ...(held
                  ? [
                      {
                        label: "Lo que tenés",
                        value: summary.unrealized?.amount ?? "0",
                      },
                    ]
                  : []),
              ]),
            ),
          ]
        : [],
      sources: [SOURCES.movements, SOURCES.quotes],
    };
  }

  const closes = closesOf(state, unit);
  const years = yearsOfCloses(closes);
  const thisYear = years[0];

  if (CALENDAR.test(asked)) return calendarAnswer(state, snapshot, unit, base);

  if (
    /evoluc|historia|a lo largo|con el tiempo/.test(asked) &&
    closes.length > 0
  ) {
    const shown = closes.slice(-12);
    const first = shown[0]!;
    const last = shown.at(-1)!;
    return {
      ...base,
      text: `Tu patrimonio pasó de ${formatAmount(first.figures.startValue, unit)} a principios de ${monthName(first.period).toLowerCase()} a ${formatAmount(last.figures.endValue, unit)} hoy${shown.every((close) => close.endComplete) ? "" : WITHOUT_PRICE}.`,
      charts: [
        {
          kind: "line",
          title: "Tu patrimonio, mes a mes",
          unit,
          points: shown.map((close) => ({
            label: `${monthOf(close.period).slice(0, 3)} ${close.period.slice(2, 4)}`,
            value: close.figures.endValue,
          })),
        },
      ],
      sources: [SOURCES.closes, SOURCES.quotes],
    };
  }

  if (/deud|debo|hipotec|prestamo|tarjeta/.test(asked)) {
    const owed = valueLiabilities(state.liabilities, snapshot, {
      denominator: unit,
      referenceDollar: state.referenceDollar,
    });
    if (state.liabilities.length === 0) {
      return {
        ...base,
        text: "No tenés deudas cargadas en Plant.",
        charts: [],
        sources: [SOURCES.debts],
      };
    }
    const byId = new Map(owed.items.map((item) => [item.id, item.value]));
    // Only the debts with a value in the unit are ranked and drawn.
    const valued = state.liabilities
      .flatMap((debt) => {
        const value = byId.get(debt.id);
        return value ? [{ label: debt.label, value }] : [];
      })
      .sort((a, b) => compareDecimals(b.value, a.value));
    const count = state.liabilities.length;
    return {
      ...base,
      text: `Debés ${formatAmount(owed.total, unit)}${owed.complete ? "" : WITHOUT_PRICE} en ${countOf(count, "deuda", "deudas")}.${
        count > 1 && valued[0] ? ` La más grande es ${valued[0].label}.` : ""
      }`,
      charts:
        valued.length > 0
          ? [barsOf("debts", "Lo que debés", unit, valued)]
          : [],
      sources: [SOURCES.debts, SOURCES.quotes],
    };
  }

  if (
    /dividend|cupon|cobr|\brentas?\b(?! (fija|variable))/.test(asked) &&
    thisYear
  ) {
    return {
      ...base,
      text: `En ${thisYear.year} tus dividendos, cupones y rendimientos sumaron ${formatAmount(thisYear.totals.income, unit)}, antes de las retenciones.${thisYear.complete ? "" : PARTIAL_YEAR}`,
      charts: [
        barsOf(
          "income",
          `Rentas de ${thisYear.year}`,
          unit,
          thisYear.months.map((month) => ({
            label: monthOf(month.period).slice(0, 3),
            value: month.figures.income,
          })),
        ),
      ],
      sources: [SOURCES.movements],
    };
  }

  if (
    /rend|rind|rentab|fue|gan|perd|resultado|ano|mes/.test(asked) &&
    thisYear
  ) {
    const current = closes.at(-1)!;
    return {
      ...base,
      text: `En ${thisYear.year} tu patrimonio ${moved(thisYear.totals.result, unit)}.${bySign(
        thisYear.totals.contributed,
        unit,
        {
          down: (size) => ` Sacaste ${size} neto.`,
          up: (size) => ` Pusiste ${size} neto.`,
          even: "",
        },
      )}${
        thisYear.totals.share === null
          ? ""
          : ` ${byShare(thisYear.totals.share, {
              down: (size) =>
                `Sin contar lo que pusiste, lo que tenías perdió un ${size}.`,
              up: (size) =>
                `Sin contar lo que pusiste, lo que tenías rindió un ${size}.`,
              even: "Sin contar lo que pusiste, lo que tenías no rindió ni perdió.",
            })}`
      }${thisYear.complete ? "" : PARTIAL_YEAR} En lo que va de ${monthOf(current.period).toLowerCase()} vas ${signed(formatAmount(current.figures.result, unit), shownAmount(current.figures.result, unit))}.`,
      charts: [
        barsOf(
          "income",
          `Resultado por mes de ${thisYear.year}`,
          unit,
          thisYear.months.map((month) => ({
            label: monthOf(month.period).slice(0, 3),
            value: month.figures.result,
          })),
        ),
      ],
      sources: [SOURCES.closes, SOURCES.quotes],
    };
  }

  const today = closes.at(-1);
  if (/patrimon|tengo|vale|neto|total/.test(asked) && today) {
    const valuation = holdingsValuation({
      holdings: holdingsView(state).active,
      truncated: false,
      snapshot,
      unit,
      referenceDollar: state.referenceDollar,
    });
    const owed = valueLiabilities(state.liabilities, snapshot, {
      denominator: unit,
      referenceDollar: state.referenceDollar,
    });
    const worth = netWorthOf(today.figures.endValue, owed.total);
    return {
      ...base,
      text: `Tu patrimonio neto es ${formatAmount(worth.netWorth, unit)}${today.endComplete ? "" : WITHOUT_PRICE}: tenés ${formatAmount(worth.assets, unit)} en activos${shownSign(owed.total, unit) === 0 ? "" : ` y debés ${formatAmount(owed.total, unit)}`}.`,
      charts: [
        barsOf(
          "distribution",
          "Cómo está repartido",
          unit,
          (
            Object.entries(valuation.classes) as [
              HoldingClass,
              { value: string },
            ][]
          )
            .map(([holdingClass, sum]) => ({
              label: HOLDING_CLASS_GROUP_LABELS[holdingClass],
              value: sum.value,
            }))
            .sort((a, b) => compareDecimals(b.value, a.value)),
        ),
      ],
      sources: [SOURCES.holdings, SOURCES.debts, SOURCES.quotes],
    };
  }

  return {
    ...base,
    text: "Te puedo contar cuánto vale tu patrimonio, cómo te fue en el año o en lo que va del mes, cuánto cobraste, cuánto debés o cómo le fue a un activo puntual.",
    charts: [],
    sources: [],
  };
}

// A question in a conversation; a new one when no conversation has that id.
export function addQuestion(
  state: PrototypeState,
  {
    conversationId,
    id,
    question,
    unit,
  }: {
    conversationId: string;
    id: string;
    question: string;
    unit: ChatUnit;
  },
): PrototypeState {
  const message = { id, role: "user" as const, text: question };
  const existing = state.conversations.find(
    (each) => each.id === conversationId,
  );
  const conversation: Conversation = existing
    ? {
        ...existing,
        unit,
        messages: [...existing.messages, message],
        updatedOn: state.today,
      }
    : {
        id: conversationId,
        title: titleOf(question),
        unit,
        messages: [message],
        updatedOn: state.today,
      };
  return {
    ...state,
    askedOn: [...state.askedOn, state.today],
    conversations: [
      conversation,
      ...state.conversations.filter((each) => each.id !== conversationId),
    ],
  };
}

export function addAnswer(
  state: PrototypeState,
  conversationId: string,
  message: AssistantMessage,
): PrototypeState {
  return {
    ...state,
    conversations: state.conversations.map((each) =>
      each.id === conversationId
        ? { ...each, messages: [...each.messages, message] }
        : each,
    ),
  };
}

export const deleteConversation = (
  state: PrototypeState,
  id: string,
): PrototypeState => ({
  ...state,
  conversations: state.conversations.filter((each) => each.id !== id),
});
