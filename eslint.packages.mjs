// Lint config for packages/* and security-tests: each one's eslint.config.mjs re-exports it.
import tseslint from "typescript-eslint";

import {
  AI,
  AI_PROVIDERS,
  COST_SINK,
  fence,
  LITERAL_IMPORTS_ONLY,
  secretKeyReads,
  SERVICE_ROLE,
  SOURCE,
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
  {
    files: [`**/*.${SOURCE}`],
    // The AI SDK and the web app's modules by name too: a hoisted package or a
    // symlinked directory reaches them without a manifest entry or an `apps`
    // segment.
    rules: fence(
      [
        APPS,
        AI,
        { ...AI_PROVIDERS, regex: "^@ai-sdk/" },
        SERVICE_ROLE,
        COST_SINK,
      ],
      [...LITERAL_IMPORTS_ONLY, ...secretKeyReads],
    ),
  },
);
