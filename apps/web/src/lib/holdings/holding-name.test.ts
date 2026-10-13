import { originText } from "./holding-name";

describe("originText", () => {
  it("says a typed holding was entered by hand", () => {
    expect(originText({ kind: "manual" })).toBe("Cargada a mano");
  });

  it("names an imported holding's file and its day in es-AR", () => {
    expect(
      originText({
        kind: "import",
        fileName: "resumen.pdf",
        date: "2026-03-07",
      }),
    ).toBe("Importada de resumen.pdf el 07/03/2026");
  });
});
