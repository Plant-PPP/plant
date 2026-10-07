// Money travels as a decimal string (Money in @plant/shared). Shared by the
// web app and the packages. Bans parseFloat only; Number(x) and unary + still
// need review.
const message = "Use a decimal string (Money), never a float.";

export const moneyRules = {
  "no-restricted-globals": ["error", { name: "parseFloat", message }],
  "no-restricted-properties": [
    "error",
    { object: "Number", property: "parseFloat", message },
    { object: "globalThis", property: "parseFloat", message },
  ],
};
