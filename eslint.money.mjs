// Money travels as a decimal string (Money in @plant/shared). Shared by the
// web app and the packages so neither parses an amount into a float.
const message = "Plata como string decimal (Money), nunca float.";

export const moneyRules = {
  "no-restricted-globals": ["error", { name: "parseFloat", message }],
  "no-restricted-properties": [
    "error",
    { object: "Number", property: "parseFloat", message },
  ],
};
