import { snapshotOn } from "@plant/core";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  addAnswer,
  addQuestion,
  deleteConversation,
  prototypeAnswer,
} from "./prototype-assistant";
import { initialState } from "./prototype-store";

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
  ["¿Cuánto cobré de dividendos?", /cobraste/, "Cobros de 2026"],
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
