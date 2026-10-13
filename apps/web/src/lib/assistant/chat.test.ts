import { consultingText } from "./chat";

it("names the sources being consulted", () => {
  expect(consultingText([])).toBe("Consultando tus datos…");
  expect(consultingText(["Deudas"])).toBe("Consultando 1 fuente: Deudas…");
  expect(consultingText(["Movimientos", "Cotizaciones"])).toBe(
    "Consultando 2 fuentes: Movimientos, Cotizaciones…",
  );
});
