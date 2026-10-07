// Lint config for packages/*: each package's eslint.config.mjs re-exports it.
import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  rules: {
    // Money travels as a decimal string; a float parse is the bug this repo
    // most wants to catch in review.
    "no-restricted-globals": [
      "error",
      {
        name: "parseFloat",
        message: "Plata como string decimal (Money), nunca float.",
      },
    ],
  },
});
