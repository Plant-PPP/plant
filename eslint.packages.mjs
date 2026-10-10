// Lint config for packages/* and security-tests: each one's eslint.config.mjs re-exports it.
import tseslint from "typescript-eslint";

import {
  AI_PROVIDERS,
  ALL_FENCED,
  fence,
  LITERAL_IMPORTS_ONLY,
  secretKeyReads,
  SOURCE,
  TESTING,
} from "./eslint.fences.mjs";
import { moneyRules } from "./eslint.money.mjs";

// Apps depend on packages, never the other way; a relative path into an app
// would also reach its service-role client and its AI SDK.
const APPS = {
  regex: "(^|/)apps(/|$)",
  message: "A package may not import from an app.",
};

// The AI SDK and the web app's modules by name too: a hoisted package or a
// symlinked directory reaches them without a manifest entry or an `apps`
// segment. @ai-sdk/react too, which only the web app renders.
const packageRules = (allowed = []) =>
  fence(
    [
      APPS,
      ...ALL_FENCED.filter((module) => !allowed.includes(module)).map(
        (module) =>
          module === AI_PROVIDERS ? { ...module, regex: "^@ai-sdk/" } : module,
      ),
    ],
    [...LITERAL_IMPORTS_ONLY, ...secretKeyReads],
  );

export default tseslint.config(
  ...tseslint.configs.recommended,
  { rules: moneyRules },
  { rules: { "no-console": "error" } },
  { files: [`**/*.${SOURCE}`], rules: packageRules() },
  // Tests may also import the testing helpers.
  { files: [`**/*.test.${SOURCE}`], rules: packageRules([TESTING]) },
);
