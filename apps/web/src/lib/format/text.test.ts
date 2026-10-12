import { countOf, inSentence } from "./text";

it("puts a label inside a sentence", () => {
  expect(inSentence("Dólar MEP")).toBe("dólar MEP");
  expect(inSentence("Traspaso a Largo plazo")).toBe("traspaso a Largo plazo");
});

it("puts a count's noun in number", () => {
  expect(countOf(1, "cuenta", "cuentas")).toBe("1 cuenta");
  expect(countOf(2, "cuenta", "cuentas")).toBe("2 cuentas");
  expect(countOf(0, "cuenta", "cuentas")).toBe("0 cuentas");
});
