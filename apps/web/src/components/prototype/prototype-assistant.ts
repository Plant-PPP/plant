import { type QuoteSnapshot, valueLiabilities } from "@plant/core";
import { compareDecimals, exactOf, times, toDecimal } from "@plant/shared";

import { formatAmount, formatShare } from "@/lib/format/amount";
import {
  type AssistantMessage,
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
import { MONTH_NAMES } from "@/lib/summary/closes";

import { closesOf, yearsOfCloses } from "./prototype-closes";
import {
  holdingsView,
  instrumentHoldings,
  type PrototypeState,
} from "./prototype-store";

type Answer = Omit<AssistantMessage, "id">;

// Case and accents ignored.
const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const percent = (fraction: string | null) =>
  fraction === null
    ? "sin dato"
    : formatShare(toDecimal(times(exactOf(fraction), exactOf("100")), 1));

const signed = (amount: string, unit: ChatUnit) =>
  `${amount.startsWith("-") ? "" : "+"}${formatAmount(amount, unit)}`;

// "ganó US$ 10" or "perdió US$ 10".
const moved = (amount: string, unit: ChatUnit) =>
  amount.startsWith("-")
    ? `perdió ${formatAmount(amount.slice(1), unit)}`
    : `ganó ${formatAmount(amount, unit)}`;

const FOLLOW_UPS = {
  netWorth: ["¿Cómo me fue este año?", "¿Cuánto debo?"],
  year: ["¿Cuánto cobré de dividendos?", "¿Cuánto vale mi patrimonio hoy?"],
  income: ["¿Cómo me fue este año?", "¿Cómo le fue a Apple?"],
  debts: ["¿Cuánto vale mi patrimonio hoy?", "¿Cómo me fue este año?"],
  instrument: ["¿Cómo me fue este año?", "¿Cuánto cobré de dividendos?"],
};

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
  const rate =
    unit === "ars"
      ? null
      : {
          label: unit === "usd_mep" ? "MEP" : "CCL",
          sell: snapshot.fx[unit === "usd_mep" ? "mep" : "ccl"]?.sell ?? "0",
        };
  const base = { role: "assistant" as const, asOf: state.today, rate };

  if (/compr|vend|conviene|recomend|invert|deberia|me sale/.test(asked)) {
    return {
      ...base,
      text: "No te puedo decir qué comprar ni qué vender: Plant explica tus datos y no recomienda. Sí te puedo contar cómo vienen tus inversiones, cuánto ganaste o cuánto cobraste.",
      chart: null,
      sources: [],
      followUps: ["¿Cómo me fue este año?", "¿Cuánto vale mi patrimonio hoy?"],
    };
  }

  const instrument = state.instruments.find(
    (each) =>
      new RegExp(`\\b${folded(each.symbol)}\\b`).test(asked) ||
      asked.includes(folded(each.name)),
  );
  if (instrument) {
    const { holdings, flows } = instrumentHoldings(
      state,
      instrument.symbol,
      unit,
      snapshot,
    );
    if (holdings.length === 0) {
      return {
        ...base,
        text: `No tenés ni tuviste ${instrument.name} en Plant.`,
        chart: null,
        sources: ["Tus tenencias"],
        followUps: FOLLOW_UPS.instrument,
      };
    }
    const summary = instrumentSummary(holdings, flows, state.today);
    const returns = summary.returns;
    return {
      ...base,
      text: [
        `Hoy tenés ${instrument.symbol} por ${summary.value ? formatAmount(summary.value, unit) : "un valor sin cotización"}.`,
        returns
          ? `En total, entre lo que vendiste, lo que cobraste y lo que tenés, tu inversión ${moved(returns.result, unit)} (${percent(returns.share)} sobre lo que pusiste)${returns.annual ? `, un ${percent(returns.annual)} por año` : ""}.`
          : "",
        summary.unrealized
          ? `Lo que tenés hoy está ${summary.unrealized.amount.startsWith("-") ? "abajo" : "arriba"} ${formatAmount(summary.unrealized.amount.replace(/^-/, ""), unit)} contra lo que te costó.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      chart: returns
        ? {
            title: `${instrument.symbol}: de dónde sale el resultado`,
            unit,
            bars: [
              { label: "Ventas", value: summary.realized ?? "0" },
              { label: "Cobros", value: summary.income ?? "0" },
              {
                label: "Lo que tenés",
                value: summary.unrealized?.amount ?? "0",
              },
            ],
          }
        : null,
      sources: ["Movimientos", "Cotizaciones"],
      followUps: FOLLOW_UPS.instrument,
    };
  }

  const closes = closesOf(state, unit);
  const years = yearsOfCloses(closes);
  const thisYear = years[0];

  if (/deud|debo|hipotec|prestamo|tarjeta/.test(asked)) {
    const owed = valueLiabilities(state.liabilities, snapshot, {
      denominator: unit,
      referenceDollar: state.referenceDollar,
    });
    const byId = new Map(owed.items.map((item) => [item.id, item.value]));
    return {
      ...base,
      text: `Debés ${formatAmount(owed.total, unit)} en ${state.liabilities.length} deudas. La más grande es ${
        [...state.liabilities].sort((a, b) =>
          compareDecimals(byId.get(b.id) ?? "0", byId.get(a.id) ?? "0"),
        )[0]?.label ?? "—"
      }.`,
      chart: {
        title: "Lo que debés",
        unit,
        bars: state.liabilities.map((debt) => ({
          label: debt.label,
          value: byId.get(debt.id) ?? "0",
        })),
      },
      sources: ["Deudas", "Cotizaciones"],
      followUps: FOLLOW_UPS.debts,
    };
  }

  if (/dividend|cupon|cobr|renta/.test(asked) && thisYear) {
    return {
      ...base,
      text: `En ${thisYear.year} cobraste ${formatAmount(thisYear.totals.income, unit)} de dividendos y cupones, ya sin las retenciones.`,
      chart: {
        title: `Cobros de ${thisYear.year}`,
        unit,
        bars: thisYear.months.map((month) => ({
          label: MONTH_NAMES[Number(month.period.slice(5, 7)) - 1]!.slice(0, 3),
          value: month.figures.income,
        })),
      },
      sources: ["Movimientos"],
      followUps: FOLLOW_UPS.income,
    };
  }

  if (/rend|fue|gan|perd|resultado|ano|mes/.test(asked) && thisYear) {
    const current = closes.at(-1)!;
    return {
      ...base,
      text: `En ${thisYear.year} tu patrimonio ${moved(thisYear.totals.result, unit)}, un ${percent(thisYear.totals.share)} sin contar lo que pusiste (pusiste ${formatAmount(thisYear.totals.contributed, unit)} neto). En lo que va de ${MONTH_NAMES[Number(current.period.slice(5, 7)) - 1]!.toLowerCase()} vas ${signed(current.figures.result, unit)}.`,
      chart: {
        title: `Resultado por mes de ${thisYear.year}`,
        unit,
        bars: thisYear.months.map((month) => ({
          label: MONTH_NAMES[Number(month.period.slice(5, 7)) - 1]!.slice(0, 3),
          value: month.figures.result,
        })),
      },
      sources: ["Cierres", "Cotizaciones"],
      followUps: FOLLOW_UPS.year,
    };
  }

  if (/patrimon|tengo|vale|neto|total/.test(asked)) {
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
    return {
      ...base,
      text: `Tu patrimonio neto es ${formatAmount(closes.at(-1)?.figures.endValue ?? "0", unit)}: tenés ${formatAmount(valuation.kinds.total.value, unit)} en activos y debés ${formatAmount(owed.total, unit)}.`,
      chart: {
        title: "Cómo está repartido",
        unit,
        bars: (
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
      },
      sources: ["Tus tenencias", "Deudas", "Cotizaciones"],
      followUps: FOLLOW_UPS.netWorth,
    };
  }

  return {
    ...base,
    text: "Te puedo contar cuánto vale tu patrimonio, cómo te fue en el año o en un mes, cuánto cobraste, cuánto debés o cómo le fue a un activo puntual.",
    chart: null,
    sources: [],
    followUps: ["¿Cuánto vale mi patrimonio hoy?", "¿Cómo me fue este año?"],
  };
}

// A question in a conversation, a new one when `conversationId` is null.
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
