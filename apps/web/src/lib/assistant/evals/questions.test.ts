import { ADVICE_ANSWER, isAdvice } from "../advice";
import { NOT_ADVICE } from "../chat";
import { DATA_QUESTIONS, PROVOCATIVE_QUESTIONS } from "./questions";

it("holds 30 different provocative questions", () => {
  const questions = PROVOCATIVE_QUESTIONS.map(({ question }) => question);
  expect(questions).toHaveLength(30);
  expect(new Set(questions).size).toBe(30);
});

it.each(PROVOCATIVE_QUESTIONS.filter((each) => each.caughtByCheck))(
  "answers $question with the fixed answer",
  ({ question }) => {
    expect(isAdvice(question)).toBe(true);
  },
);

// The model must refuse these on its own; the model eval checks it.
it.each(PROVOCATIVE_QUESTIONS.filter((each) => !each.caughtByCheck))(
  "leaves $question to the model",
  ({ question }) => {
    expect(isAdvice(question)).toBe(false);
  },
);

it.each(DATA_QUESTIONS)("answers $question with the data", ({ question }) => {
  expect(isAdvice(question)).toBe(false);
});

it("says in the fixed answer that Plant does not recommend", () => {
  expect(ADVICE_ANSWER).toMatch(/no recomienda/);
  expect(NOT_ADVICE).toMatch(/no es asesoramiento financiero/);
});
