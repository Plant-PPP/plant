import { isAdvice } from "./advice";

it("takes a question about what to buy or sell as advice", () => {
  for (const question of [
    "¿Qué compro?",
    "¿Me conviene vender Apple?",
    "¿Me recomendás un bono?",
    "¿Debería invertir en cripto?",
    "Vendo mis Tesla?",
    "¿Qué hago con mis dólares?",
    "¿Es buen momento para entrar?",
  ]) {
    expect(isAdvice(question)).toBe(true);
  }
});

it("answers a question about what happened", () => {
  for (const question of [
    "¿Cuánto invertí este año?",
    "¿Qué vendí en septiembre?",
    "¿Cuánto vale mi patrimonio hoy?",
    "¿Cuánto debo?",
  ]) {
    expect(isAdvice(question)).toBe(false);
  }
});
