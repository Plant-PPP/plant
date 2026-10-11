import { type QuoteSnapshot, valueLiabilities } from "@plant/core";
import { compareDecimals, exactOf, minus, plus, stored } from "@plant/shared";

import { formatAmount, formatFraction } from "@/lib/format/amount";
import { folded } from "@/lib/format/text";
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
import { monthOf } from "@/lib/summary/closes";

import { closesOf, yearsOfCloses } from "./prototype-closes";
import {
  holdingsView,
  instrumentHoldings,
  type PrototypeState,
} from "./prototype-store";

type Answer = Omit<AssistantMessage, "id">;

// A question that asks what to do, not what happened: "¿qué compro?",
// "¿me conviene vender?", "¿me recomendás…?", "¿debería invertir…?",
// "¿vendo Apple?", "¿qué hago con mis Tesla?", "¿es buen momento?".
const ADVICE =
  /\b(que|cual|cuanto) (compro|vendo|invierto)\b|^\W*(compro|vendo|invierto)\b|conviene|recomend|(deberia|debo|tengo que) (comprar|vender|invertir)|me sale (comprar|vender)|que hago con|buen momento/;

// Where a result comes from, bar by bar: what is left once sales (net of
// their charges), income and the units held are counted is what purchases'
// charges and withholding took, so the bars add up to the result.
function resultBars(
  result: string,
  bars: { label: string; value: string }[],
): { label: string; value: string }[] {
  const rest = stored(
    minus(exactOf(result), plus(...bars.map(({ value }) => exactOf(value)))),
  );
  return exactOf(rest).n === 0n
    ? bars
    : [...bars, { label: "Gastos y retenciones", value: rest }];
}

// What a figure that left something out says after it.
const WITHOUT_PRICE = " (sin contar lo que no tiene cotización)";

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
  const words = asked.split(/[^a-z0-9]+/);
  const dollar =
    unit === "ars" ? null : snapshot.fx[unit === "usd_mep" ? "mep" : "ccl"];
  const rate = dollar
    ? { label: unit === "usd_mep" ? "MEP" : "CCL", sell: dollar.sell }
    : null;
  const base = { role: "assistant" as const, asOf: state.today, rate };

  if (ADVICE.test(asked)) {
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
      words.includes(folded(each.symbol)) || asked.includes(folded(each.name)),
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
          ? `En total, entre lo que vendiste, lo que cobraste y lo que tenés, tu inversión ${moved(returns.result, unit)}${returns.share ? ` (${formatFraction(returns.share)} sobre lo que pusiste)` : ""}${returns.annual ? `, un ${formatFraction(returns.annual)} por año` : ""}.`
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
            bars: resultBars(returns.result, [
              { label: "Ventas", value: summary.realized ?? "0" },
              { label: "Cobros", value: summary.income ?? "0" },
              {
                label: "Lo que tenés",
                value: summary.unrealized?.amount ?? "0",
              },
            ]),
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
    if (state.liabilities.length === 0) {
      return {
        ...base,
        text: "No tenés deudas cargadas en Plant.",
        chart: null,
        sources: ["Deudas"],
        followUps: FOLLOW_UPS.debts,
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
      text: `Debés ${formatAmount(owed.total, unit)}${owed.complete ? "" : WITHOUT_PRICE} en ${count === 1 ? "1 deuda" : `${count} deudas`}.${
        count > 1 && valued[0] ? ` La más grande es ${valued[0].label}.` : ""
      }`,
      chart:
        valued.length > 0
          ? { title: "Lo que debés", unit, bars: valued }
          : null,
      sources: ["Deudas", "Cotizaciones"],
      followUps: FOLLOW_UPS.debts,
    };
  }

  if (/dividend|cupon|cobr|renta/.test(asked) && thisYear) {
    return {
      ...base,
      text: `En ${thisYear.year} cobraste ${formatAmount(thisYear.totals.income, unit)} de dividendos y cupones, antes de las retenciones.`,
      chart: {
        title: `Cobros de ${thisYear.year}`,
        unit,
        bars: thisYear.months.map((month) => ({
          label: monthOf(month.period).slice(0, 3),
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
      text: `En ${thisYear.year} tu patrimonio ${moved(thisYear.totals.result, unit)}${thisYear.complete ? "" : WITHOUT_PRICE}${thisYear.totals.share ? `, un ${formatFraction(thisYear.totals.share)} sin contar lo que pusiste` : ""} (pusiste ${formatAmount(thisYear.totals.contributed, unit)} neto). En lo que va de ${monthOf(current.period).toLowerCase()} vas ${signed(current.figures.result, unit)}.`,
      chart: {
        title: `Resultado por mes de ${thisYear.year}`,
        unit,
        bars: thisYear.months.map((month) => ({
          label: monthOf(month.period).slice(0, 3),
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
      text: `Tu patrimonio neto es ${formatAmount(closes.at(-1)?.figures.endValue ?? "0", unit)}${valuation.kinds.total.complete && owed.complete ? "" : WITHOUT_PRICE}: tenés ${formatAmount(valuation.kinds.total.value, unit)} en activos y debés ${formatAmount(owed.total, unit)}.`,
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
