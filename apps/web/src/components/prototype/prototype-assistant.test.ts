import { snapshotOn } from "@plant/core";

import { instrumentSummary } from "@/lib/holdings/instrument-history";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  addAnswer,
  addQuestion,
  deleteConversation,
  prototypeAnswer,
} from "./prototype-assistant";
import { initialState, instrumentHoldings } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);
const snapshot = snapshotOn(state.quotes, TODAY, {
  fxKinds: ["mep", "ccl", "official", "uva"],
  symbols: state.instruments.map(({ symbol }) => symbol),
}).snapshot;
const ask = (question: string) =>
  prototypeAnswer(state, question, "usd_mep", snapshot);

it("never says what to buy or sell", () => {
  for (const question of ["¿Qué compro?", "¿Me conviene vender BTC?"]) {
    const answer = ask(question);
    expect(answer.text).toMatch(/no recomienda/);
    expect(answer.chart).toBeNull();
  }
});

it.each([
  [
    "¿Cuánto vale mi patrimonio hoy?",
    /patrimonio neto es/,
    "Cómo está repartido",
  ],
  [
    "¿Cómo me fue este año?",
    /En 2026 tu patrimonio/,
    "Resultado por mes de 2026",
  ],
  ["¿Cuánto cobré de dividendos?", /sumaron/, "Rentas de 2026"],
  ["¿Cuánto debo?", /Debés/, "Lo que debés"],
  ["¿Cómo le fue a Apple?", /AAPL/, "AAPL: de dónde sale el resultado"],
])("answers %s from the data, with a chart", (question, text, chart) => {
  const answer = ask(question);
  expect(answer.text).toMatch(text);
  expect(answer.chart?.title).toBe(chart);
  expect(answer.rate?.label).toBe("MEP");
  expect(answer.sources.length).toBeGreaterThan(0);
});

it("keeps a conversation's questions and answers, titled by its first", () => {
  const asked = addQuestion(state, {
    conversationId: "c1",
    id: "m1",
    question: "¿Cuánto debo?",
    unit: "ars",
  });
  const answered = addAnswer(asked, "c1", {
    id: "m2",
    ...ask("¿Cuánto debo?"),
  });
  expect(answered.conversations[0]).toMatchObject({
    title: "¿Cuánto debo?",
    unit: "ars",
  });
  expect(answered.conversations[0]!.messages).toHaveLength(2);
});

it.each(["¿Cuánto invertí en Apple?", "¿Qué vendí este año?"])(
  "answers %s, which asks what happened, not what to do",
  (question) => {
    expect(ask(question).text).not.toMatch(/no recomienda/);
  },
);

it("shows no dollar rate it does not have", () => {
  const answer = prototypeAnswer(state, "¿Cuánto debo?", "usd_mep", {
    ...snapshot,
    fx: {},
  });
  expect(answer.rate).toBeNull();
});

it("still counts a question once its conversation is deleted", () => {
  const asked = addQuestion(state, {
    conversationId: "c1",
    id: "m1",
    question: "¿Cuánto debo?",
    unit: "ars",
  });
  const deleted = deleteConversation(asked, "c1");
  expect(deleted.conversations).toEqual([]);
  expect(deleted.askedOn).toEqual([TODAY]);
});

it.each([
  "¿Debo vender mis acciones?",
  "¿Vendo Apple?",
  "¿Compro más Bitcoin?",
  "¿Qué hago con mis Tesla?",
  "¿Es buen momento para invertir?",
])("does not advise on %s", (question) => {
  expect(ask(question).text).toMatch(/no recomienda/);
});

it("answers about debts with none loaded", () => {
  const answer = prototypeAnswer(
    { ...state, liabilities: [] },
    "¿Cuánto debo?",
    "usd_mep",
    snapshot,
  );
  expect(answer.text).toBe("No tenés deudas cargadas en Plant.");
  expect(answer.chart).toBeNull();
});

it("draws an instrument's result as bars that add up to it", () => {
  const { holdings, flows, value } = instrumentHoldings(
    state,
    "AAPL",
    "usd_mep",
    snapshot,
  );
  const result = instrumentSummary(holdings, flows, TODAY, value).returns!
    .result;
  const bars = ask("¿Cómo le fue a Apple?").chart!.bars;
  expect(bars.reduce((sum, bar) => sum + Number(bar.value), 0)).toBeCloseTo(
    Number(result),
    6,
  );
});

it("says an instrument sold out is no longer held", () => {
  const text = ask("¿Cómo le fue a Tesla?").text;
  expect(text).toMatch(/^Ya no tenés TSLA\./);
  expect(text).not.toMatch(/lo que tenés/i);
  expect(text).toMatch(/entre lo que vendiste y lo que cobraste/);
});

it.each(["¿Cuál fue mi rentabilidad este año?", "¿Fue rentable mi cartera?"])(
  "answers %s about the year, not dividends",
  (question) => {
    expect(ask(question).text).toMatch(/tu patrimonio/);
  },
);

it.each([
  ["¿Cómo le fue a Mercado Libre?", "MELI"],
  ["¿Cómo le fue a Coca Cola?", "KO"],
])("finds the instrument in %s", (question, symbol) => {
  expect(ask(question).text).toMatch(new RegExp(symbol));
});

it.each(["¿Cuánto tenía antes la cartera?", "¿Cuánto tengo en renta fija?"])(
  "does not mistake %s for an instrument or for income",
  (question) => {
    const text = ask(question).text;
    expect(text).not.toMatch(/TSLA|Tesla|de dividendos y cupones/);
  },
);

it("answers how the portfolio did when asked what it yielded", () => {
  expect(ask("¿Cuánto rindió mi cartera?").text).toMatch(/tu patrimonio/);
});

it("reads rendimientos as the year's result, not as income", () => {
  const answer = ask("¿Cómo vinieron mis rendimientos este año?");
  expect(answer.text).toMatch(/En 2026 tu patrimonio/);
  expect(answer.chart?.title).toBe("Resultado por mes de 2026");
});
