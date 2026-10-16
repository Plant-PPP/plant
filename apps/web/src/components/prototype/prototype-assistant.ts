import { isOwed, type QuoteSnapshot, valueLiabilities } from "@plant/core";
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

import {
  changeBetween,
  closesOf,
  debtsToday,
  pricedToday,
  yearsOfCloses,
} from "@/lib/summary/compute";
import {
  changeChart,
  changePeriod,
  lastClosed,
} from "@/lib/assistant/month-change";
import {
  assumptionsOf,
  priceTarget,
  scenarioChart,
  scenarioOf,
  type Shock,
  validChange,
} from "@/lib/assistant/scenario";
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

// A hypothetical: "si el MEP sube 10 %", "¿y si Apple cae 20%?", "si el
// dólar baja un 5 por ciento".
const SCENARIO =
  /\bsi\b.*?\b(sub|baj|ca[eiy]|aument|crec)\w*\s+(?:un\s+|el\s+)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:%|por ?ciento)/;

// The shock a hypothetical question names, or none when it names no dollar,
// instrument or prices it can move.
function shockOf(
  asked: string,
  words: readonly string[],
  instrument: { symbol: string } | undefined,
): Shock | null {
  const match = SCENARIO.exec(asked);
  if (!match) return null;
  const size = match[2]!.replace(",", ".");
  const change = /^(baj|ca)/.test(match[1]!) ? `-${size}` : size;
  if (!validChange(change)) return null;
  const dollar = words.includes("mep")
    ? "mep"
    : words.includes("ccl")
      ? "ccl"
      : words.includes("oficial")
        ? "official"
        : words.includes("dolar")
          ? "all"
          : null;
  if (dollar) return { dollar: { kind: dollar, change } };
  if (instrument) return { price: { symbol: instrument.symbol, change } };
  if (/precio|accion|mercado|todo/.test(asked)) {
    return { price: { symbol: null, change } };
  }
  return null;
}

// At today's quotes as the closes value them, as the real tool does.
function scenarioAnswer(
  state: PrototypeState,
  unit: ChatUnit,
  shock: Shock,
  base: Pick<Answer, "role" | "asOf" | "rate" | "table">,
): Answer {
  const name = shock.price?.symbol
    ? (state.instruments.find((each) => each.symbol === shock.price!.symbol)
        ?.name ?? null)
    : null;
  const holdings = holdingsView(state).active.map((row) => row.holding);
  const snapshot = pricedToday(state);
  const sources = [SOURCES.holdings, SOURCES.debts, SOURCES.quotes];
  if (shock.price?.symbol) {
    const target = priceTarget(holdings, snapshot, shock.price.symbol);
    if (target !== "held") {
      return {
        ...base,
        text:
          target === "not_held"
            ? `No tenés ${name ?? shock.price.symbol}, así que su precio no cambia tu patrimonio.`
            : `No hay un precio de hoy de ${name ?? shock.price.symbol} para calcularlo.`,
        charts: [],
        sources,
      };
    }
  }
  const outcome = scenarioOf({
    holdings,
    liabilities: debtsToday(state),
    snapshot,
    unit,
    referenceDollar: state.referenceDollar,
    shock,
  });
  const said = assumptionsOf(shock, name);
  const parts = (["dollar", "price"] as const).filter((part) => said[part]);
  const moving = parts.filter((part) => !outcome.idle.includes(part));
  const still = outcome.idle.map((part) => said[part]!);
  if (moving.length === 0) {
    return {
      ...base,
      text: `Hipotético: si ${still.join(" y ")}, tu patrimonio neto no cambiaría: nada de lo que tenés o debés depende de eso.`,
      charts: [],
      sources,
    };
  }
  const share =
    outcome.share === null || shownSign(outcome.change, unit) === 0
      ? ""
      : `, ${formatFraction(outcome.share)}`;
  return {
    ...base,
    text: `Hipotético: si ${moving.map((part) => said[part]!).join(" y ")}, tu patrimonio neto pasaría de ${formatAmount(outcome.today.netWorth, unit)} a ${formatAmount(outcome.scenario.netWorth, unit)}${outcome.complete ? "" : WITHOUT_PRICE}: ${signed(formatAmount(outcome.change, unit), shownAmount(outcome.change, unit))}${share}.${
      still.length === 0
        ? ""
        : ` Que ${still.join(" y ")} no cambia nada de lo que tenés o debés.`
    } Es un cálculo con las cotizaciones de hoy que mueve solo eso y deja igual el resto; no es una predicción.`,
    charts: [scenarioChart(outcome, unit)],
    sources,
  };
}

// A question about the month: "¿por qué cambió mi patrimonio?", "resumen
// del mes", "¿qué pasó el mes pasado?".
const MONTH =
  /por que (cambio|subio|bajo|vario|se movio|crecio|cayo)|resumen del mes|resumi\w* el mes|mes pasado|cierre del mes|ultimo cierre/;

function monthAnswer(
  state: PrototypeState,
  unit: ChatUnit,
  base: Pick<Answer, "role" | "asOf" | "rate" | "table">,
): Answer | null {
  const period = lastClosed(closesOf(state, unit));
  const change = period && changeBetween(state, unit, period, period);
  if (!change) return null;
  const parts = [
    bySign(change.contributed, unit, {
      down: (size) => `sacaste ${size}`,
      up: (size) => `pusiste ${size}`,
      even: "no pusiste ni sacaste plata",
    }),
    bySign(change.prices, unit, {
      down: (size) => `los precios restaron ${size}`,
      up: (size) => `los precios sumaron ${size}`,
      even: "los precios no movieron nada",
    }),
    bySign(change.dollar, unit, {
      down: (size) => `el dólar restó ${size}`,
      up: (size) => `el dólar sumó ${size}`,
      even: "el dólar no movió nada",
    }),
    ...(shownSign(change.yields, unit) === 0
      ? []
      : [`los rendimientos sumaron ${formatAmount(change.yields, unit)}`]),
    ...(shownSign(change.interest, unit) === 0
      ? []
      : [
          bySign(change.interest, unit, {
            down: (size) => `los intereses de tus deudas restaron ${size}`,
            up: (size) => `los intereses de tus deudas sumaron ${size}`,
            even: "",
          }),
        ]),
  ];
  const total = stored(
    minus(exactOf(change.endValue), exactOf(change.startValue)),
  );
  return {
    ...base,
    text: `En ${changePeriod(change)} tu patrimonio pasó de ${formatAmount(change.startValue, unit)} a ${formatAmount(change.endValue, unit)} (${signed(formatAmount(total, unit), shownAmount(total, unit))}): ${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}.${
      shownSign(change.income, unit) === 0
        ? ""
        : ` Cobraste ${formatAmount(change.income, unit)} de dividendos, cupones y rentas, antes de las retenciones.`
    }${
      change.share === null
        ? ""
        : ` ${byShare(change.share, {
            down: (size) =>
              `Sin contar lo que pusiste, lo que tenías perdió un ${size}`,
            up: (size) =>
              `Sin contar lo que pusiste, lo que tenías rindió un ${size}`,
            even: "Sin contar lo que pusiste, lo que tenías no rindió ni perdió",
          })}${
            change.benchmarks.inflation === null
              ? "."
              : `; la inflación fue ${formatFraction(change.benchmarks.inflation)}.`
          }`
    }${change.complete ? "" : " Al mes le falta algún dato; mirá su cierre."}`,
    charts: [changeChart(change, unit)],
    sources: [SOURCES.closes, SOURCES.movements, SOURCES.quotes],
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
  const shock = shockOf(asked, words, instrument);
  if (shock) return scenarioAnswer(state, unit, shock, base);
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

  if (MONTH.test(asked)) {
    const answer = monthAnswer(state, unit, base);
    if (answer) return answer;
  }

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
    const owed = valueLiabilities(debtsToday(state), snapshot, {
      denominator: unit,
      referenceDollar: state.referenceDollar,
    });
    const live = debtsToday(state).filter(isOwed);
    if (live.length === 0) {
      return {
        ...base,
        text: "No tenés deudas pendientes en Plant.",
        charts: [],
        sources: [SOURCES.debts],
      };
    }
    const byId = new Map(owed.items.map((item) => [item.id, item.value]));
    // Only the debts with a value in the unit are ranked and drawn.
    const valued = live
      .flatMap((debt) => {
        const value = byId.get(debt.id);
        return value ? [{ label: debt.label, value }] : [];
      })
      .sort((a, b) => compareDecimals(b.value, a.value));
    const count = live.length;
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
    const owed = valueLiabilities(debtsToday(state), snapshot, {
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
    text: "Te puedo contar cuánto vale tu patrimonio, cómo te fue en el año o en lo que va del mes, por qué cambió el mes pasado, cuánto cobraste, cuánto debés, cómo le fue a un activo puntual o qué pasaría si el dólar o un precio se moviera.",
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
