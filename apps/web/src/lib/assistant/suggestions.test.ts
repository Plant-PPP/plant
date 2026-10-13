import { SUGGESTED_QUESTIONS } from "./chat";
import { consultingText, suggestionsFor } from "./suggestions";

it("offers each screen's own questions, and the general ones elsewhere", () => {
  expect(suggestionsFor("/debts")).toContain("¿Cuánto debo?");
  expect(suggestionsFor("/assets/0b0e")).toContain(
    "¿Cómo está repartido mi patrimonio?",
  );
  expect(suggestionsFor("/closes/2026-09")).toContain(
    "¿Cómo me fue en lo que va del mes?",
  );
  expect(suggestionsFor("/")).toBe(SUGGESTED_QUESTIONS);
  expect(suggestionsFor("/accounts")).toBe(SUGGESTED_QUESTIONS);
});

it("names the sources being consulted", () => {
  expect(consultingText([])).toBe("Consultando tus datos…");
  expect(consultingText(["Deudas"])).toBe("Consultando 1 fuente: Deudas…");
  expect(consultingText(["Movimientos", "Cotizaciones"])).toBe(
    "Consultando 2 fuentes: Movimientos, Cotizaciones…",
  );
});
