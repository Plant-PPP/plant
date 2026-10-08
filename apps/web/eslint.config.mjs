import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

import { moneyRules } from "../../eslint.money.mjs";

const SOURCE = "{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

// Who may reach a model and the secret key. Each fenced module is a regex
// over the import specifier, with or without a file extension.
const EXTENSION = String.raw`(\.[cm]?[jt]sx?)?`;
const AI_MESSAGE = "Only src/lib/ai may call a model, so every call is costed.";
const AI = { regex: "^ai(/.*)?$", message: AI_MESSAGE };
const AI_PROVIDERS = { regex: "^@ai-sdk/(?!react(/|$))", message: AI_MESSAGE };
const SERVICE_ROLE = {
  regex: `(^|/)service-role${EXTENSION}$`,
  message: "The secret key bypasses RLS; only the AI cost sink holds it.",
};
const COST_SINK = {
  regex: `(^|/)ai-cost-sink${EXTENSION}$`,
  message: "The cost sink writes past RLS; only route handlers may use it.",
};

// The fences read import specifiers, so a computed one cannot pass them.
const LITERAL_IMPORTS_ONLY = [
  'ImportExpression[source.type!="Literal"]',
  'CallExpression[callee.name="require"][arguments.0.type!="Literal"]',
].map((selector) => ({
  selector,
  message: "Import a module by a string literal so the import fences see it.",
}));
const SECRET_KEY_READS = [
  'Identifier[name="SUPABASE_SERVICE_ROLE_KEY"]',
  'Literal[value="SUPABASE_SERVICE_ROLE_KEY"]',
  'TemplateElement[value.raw="SUPABASE_SERVICE_ROLE_KEY"]',
].map((selector) => ({
  selector,
  message: "Only src/lib/supabase/service-role.ts reads the secret key.",
}));

// The rules for one block: a later block replaces the rule's options, so each
// lists everything it keeps. no-restricted-imports does not see import() or
// require(), so the same regexes go to no-restricted-syntax.
function fence(
  modules,
  syntax = [...LITERAL_IMPORTS_ONLY, ...SECRET_KEY_READS],
) {
  const asSelector = (regex) => `/${regex.replaceAll("/", "\\/")}/`;
  return {
    "no-restricted-imports": [
      "error",
      { patterns: modules.map(({ regex, message }) => ({ regex, message })) },
    ],
    "no-restricted-syntax": [
      "error",
      ...modules.flatMap(({ regex, message }) => [
        {
          selector: `ImportExpression[source.value=${asSelector(regex)}]`,
          message,
        },
        {
          selector: `CallExpression[callee.name="require"][arguments.0.value=${asSelector(regex)}]`,
          message,
        },
      ]),
      ...syntax,
    ],
  };
}

const NO_SERVER_ACTION = ["Program", ":function > BlockStatement"].map(
  (parent) => ({
    selector: `${parent} > ExpressionStatement[directive="use server"]`,
    message:
      "The cost sink writes rows for any user_id; a server action would make it a public endpoint.",
  }),
);

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: moneyRules },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/log/server-log.ts"],
    rules: { "no-console": "error" },
  },
  {
    files: [`src/**/*.${SOURCE}`],
    rules: fence([AI, AI_PROVIDERS, SERVICE_ROLE, COST_SINK]),
  },
  {
    files: [`src/lib/ai/**/*.${SOURCE}`],
    rules: fence([SERVICE_ROLE, COST_SINK]),
  },
  {
    files: ["src/lib/ai/ai-cost-sink.ts"],
    rules: fence(
      [],
      [...NO_SERVER_ACTION, ...LITERAL_IMPORTS_ONLY, ...SECRET_KEY_READS],
    ),
  },
  {
    files: ["src/lib/supabase/service-role.ts"],
    rules: fence([AI, AI_PROVIDERS, COST_SINK], LITERAL_IMPORTS_ONLY),
  },
  {
    files: [`src/app/api/**/route.${SOURCE}`],
    rules: fence([AI, AI_PROVIDERS, SERVICE_ROLE]),
  },
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
