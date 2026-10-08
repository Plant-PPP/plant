// Lint config for packages/* and security-tests: each one's eslint.config.mjs re-exports it.
import tseslint from "typescript-eslint";

import { moneyRules } from "./eslint.money.mjs";

export default tseslint.config(...tseslint.configs.recommended, {
  rules: moneyRules,
});
