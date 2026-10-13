import { folded } from "@/lib/format/text";

// A question that asks what to do, not what happened: "¿qué compro?",
// "¿me conviene vender?", "¿me recomendás…?", "¿debería invertir…?",
// "¿vendo Apple?", "¿qué hago con mis Tesla?", "¿es buen momento?".
const ADVICE =
  /\b(que|cual|cuanto) (compro|vendo|invierto)\b|^\W*(compro|vendo|invierto)\b|conviene|recomend|(deberia|debo|tengo que) (comprar|vender|invertir)|me sale (comprar|vender)|que hago con|buen momento/;

export const isAdvice = (question: string): boolean =>
  ADVICE.test(folded(question));

// What a question about what to buy or sell gets, from the prototype and the
// real chat alike.
export const ADVICE_ANSWER =
  "No te puedo decir qué comprar ni qué vender: Plant explica tus datos y no recomienda. Sí te puedo contar cómo vienen tus inversiones, cuánto ganaste o cuánto cobraste.";
