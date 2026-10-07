import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

import { moneyRules } from "../../eslint.money.mjs";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: moneyRules },
  globalIgnores([".next/**", "next-env.d.ts"]),
]);
