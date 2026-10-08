// Lint config for packages/* and security-tests: each one's eslint.config.mjs re-exports it.
import tseslint from "typescript-eslint";

import {
  fence,
  LITERAL_IMPORTS_ONLY,
  secretKeyReads,
} from "./eslint.fences.mjs";
import { moneyRules } from "./eslint.money.mjs";

// Apps depend on packages, never the other way; a relative path into an app
// would also reach its service-role client and its AI SDK.
const APPS = {
  regex: "(^|/)apps(/|$)",
  message: "A package may not import from an app.",
};

export default tseslint.config(
  ...tseslint.configs.recommended,
  { rules: moneyRules },
  { rules: { "no-console": "error" } },
  { rules: fence([APPS], [...LITERAL_IMPORTS_ONLY, ...secretKeyReads]) },
);
