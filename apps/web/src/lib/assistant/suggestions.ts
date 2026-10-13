import { countOf } from "@/lib/format/text";
import { isUnder } from "@/lib/paths";

import { SUGGESTED_QUESTIONS } from "./chat";

// The questions the assistant offers first on each screen, about what that
// screen shows; a screen not listed gets the general ones.
const BY_SCREEN: readonly (readonly [string, readonly string[]])[] = [
  [
    "/assets",
    [
      "¿Cómo está repartido mi patrimonio?",
      "¿Cómo me fue este año?",
      "¿Cuánto cobré de dividendos?",
      "¿Qué cobro este mes?",
      "¿Cómo le fue a Apple?",
    ],
  ],
  ["/debts", ["¿Cuánto debo?", "¿Cuál es mi deuda más grande?"]],
  ["/closes", ["¿Cómo me fue este año?", "¿Cómo me fue en lo que va del mes?"]],
];

export function suggestionsFor(pathname: string): readonly string[] {
  return (
    BY_SCREEN.find(([href]) => isUnder(href, pathname))?.[1] ??
    SUGGESTED_QUESTIONS
  );
}

// What the assistant says while it reads: the sources it consults, or the
// user's data when it names none.
export function consultingText(sources: readonly string[]): string {
  if (sources.length === 0) return "Consultando tus datos…";
  return `Consultando ${countOf(sources.length, "fuente", "fuentes")}: ${sources.join(", ")}…`;
}
