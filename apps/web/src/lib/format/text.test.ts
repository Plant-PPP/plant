import { inSentence } from "./text";

it("puts a label inside a sentence", () => {
  expect(inSentence("Dólar MEP")).toBe("dólar MEP");
  expect(inSentence("Traspaso a Largo plazo")).toBe("traspaso a Largo plazo");
});
