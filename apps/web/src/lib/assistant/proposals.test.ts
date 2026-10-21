import {
  isKeptPart,
  proposalsNote,
  proposalsOf,
  questionOf,
} from "./proposals";

const debt = {
  type: "tool-proposeDebt",
  toolCallId: "call_1",
  state: "output-available",
  input: {},
  output: {
    proposal: { title: "Préstamo Nexo", lines: ["Saldo: US$ 58.480,13"] },
    input: { kind: "usd_debt" },
  },
};
const refused = {
  type: "tool-proposeAccount",
  toolCallId: "call_2",
  state: "output-available",
  output: { error: "El usuario ya tiene la cuenta Nexo." },
};
const asked = {
  type: "tool-askUser",
  toolCallId: "call_3",
  state: "output-available",
  output: { question: { text: "¿En qué cuenta?", options: ["Nexo", "IOL"] } },
};

describe("proposalsOf", () => {
  it("reads each proposal with the user's answer, pending by default", () => {
    expect(proposalsOf([debt, refused], {})).toEqual([
      {
        id: "call_1",
        kind: "debt",
        title: "Préstamo Nexo",
        lines: ["Saldo: US$ 58.480,13"],
        state: "pending",
      },
    ]);
    expect(proposalsOf([debt], { call_1: "confirmed" })[0]?.state).toBe(
      "confirmed",
    );
  });
});

it("reads the question an answer ends with", () => {
  expect(questionOf([debt, asked])).toEqual({
    id: "call_3",
    text: "¿En qué cuenta?",
    options: ["Nexo", "IOL"],
  });
  expect(questionOf([debt])).toBeNull();
});

it("keeps an answer's text, proposals and question, not its reads", () => {
  expect(
    [
      { type: "text", text: "Hola" },
      debt,
      asked,
      { type: "tool-listHoldings", state: "output-available" },
      { type: "step-start" },
    ].map(isKeptPart),
  ).toEqual([true, true, true, false, false]);
});

it("tells the model how the user answered", () => {
  expect(proposalsNote([debt], { call_1: "declined" })).toBe(
    '[Propuesta "Préstamo Nexo": el usuario la descartó]',
  );
});
