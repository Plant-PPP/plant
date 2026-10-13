import { SUGGESTED_QUESTIONS } from "@/lib/assistant/chat";

// The version of the terms a user accepts before their first file; a new
// version asks again.
export const CONSENT_VERSION = "2026-10";

export type OnboardingStep = {
  id: "consent" | "account" | "holding" | "question";
  title: string;
  done: boolean;
  href: string;
  action: string;
};

// The question a new user is offered to ask first.
export const FIRST_QUESTION = SUGGESTED_QUESTIONS[0];

// What a new user does to see their net worth: accept the terms, add an
// account, load a statement or a holding, and ask the assistant. Each step is
// done once the data says so.
export function onboardingSteps({
  consentVersion,
  accounts,
  holdings,
  questions,
}: {
  consentVersion: string | null;
  accounts: number;
  holdings: number;
  questions: number;
}): OnboardingStep[] {
  return [
    {
      id: "consent",
      title: "Aceptá los términos para cargar tus resúmenes",
      done: consentVersion === CONSENT_VERSION,
      href: "/import",
      action: "Ir a Cargar",
    },
    {
      id: "account",
      title: "Agregá tu primera cuenta: tu broker, tu banco o tu exchange",
      done: accounts > 0,
      href: "/accounts",
      action: "Ir a Cuentas",
    },
    {
      id: "holding",
      title: "Subí un resumen o cargá una tenencia a mano",
      done: holdings > 0,
      href: "/import",
      action: "Cargar un resumen",
    },
    {
      id: "question",
      title: `Preguntale al asistente: "${FIRST_QUESTION}"`,
      done: questions > 0,
      href: "/assistant",
      action: "Ir al asistente",
    },
  ];
}
