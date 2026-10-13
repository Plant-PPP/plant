import { CONSENT_VERSION, onboardingSteps } from "./steps";

const NEW_USER = {
  consentVersion: null,
  accounts: 0,
  holdings: 0,
  questions: 0,
};

it("leaves every step to do for a new user, in order", () => {
  expect(onboardingSteps(NEW_USER).map((step) => [step.id, step.done])).toEqual(
    [
      ["consent", false],
      ["account", false],
      ["holding", false],
      ["question", false],
    ],
  );
});

it("marks each step done by what the data says", () => {
  const steps = onboardingSteps({
    consentVersion: CONSENT_VERSION,
    accounts: 1,
    holdings: 0,
    questions: 2,
  });
  expect(steps.filter((step) => step.done).map((step) => step.id)).toEqual([
    "consent",
    "account",
    "question",
  ]);
});

it("asks for consent again for an older version of the terms", () => {
  expect(
    onboardingSteps({ ...NEW_USER, consentVersion: "2025-01" })[0]!.done,
  ).toBe(false);
});
