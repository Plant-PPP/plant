import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

import { moneyRules } from "../../eslint.money.mjs";
import { secretKeyReads } from "../../eslint.secret-key.mjs";

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
// A path into node_modules reaches a package without naming it.
const NODE_MODULES = {
  regex: "(^|/)node_modules(/|$)",
  message: "Import a package by its name, so the import fences see it.",
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
const asSelector = (regex) => `/${regex.replaceAll("/", "\\/")}/`;
// A module allowed to import a fenced one may not re-export it.
const noReexport = (modules) =>
  modules.flatMap(({ regex, message }) =>
    ["ExportAllDeclaration", "ExportNamedDeclaration"].map((node) => ({
      selector: `${node}[exportKind!="type"][source.value=${asSelector(regex)}]`,
      message,
    })),
  );
// The sink, route handlers and src/lib/ai export values only through a named
// declaration, so an imported sink, client or model cannot be handed on
// through an export list or a default export.
const NO_EXPORT_LIST = [
  'ExportNamedDeclaration:not([source]):not([exportKind="type"]) > ExportSpecifier:not([exportKind="type"])',
  "ExportDefaultDeclaration",
].map((selector) => ({
  selector,
  message:
    "Export through a declaration (export function, export const), so the fences see who uses what.",
}));
const BASE_SYNTAX = [
  ...LITERAL_IMPORTS_ONLY,
  ...secretKeyReads,
  ...noReexport([SERVICE_ROLE, COST_SINK]),
];
const LIB_AI_SYNTAX = [
  ...BASE_SYNTAX,
  ...noReexport([AI, AI_PROVIDERS]),
  ...NO_EXPORT_LIST,
];

// The rules for one block: a later block replaces the rule's options, so each
// lists everything it keeps. no-restricted-imports does not see import() or
// require(), so the same regexes go to no-restricted-syntax.
function fence(fenced, syntax = BASE_SYNTAX) {
  const modules = [...fenced, NODE_MODULES];
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
    files: [`**/*.${SOURCE}`],
    rules: fence([AI, AI_PROVIDERS, SERVICE_ROLE, COST_SINK]),
  },
  {
    files: [`src/lib/ai/**/*.${SOURCE}`],
    rules: fence([SERVICE_ROLE, COST_SINK], LIB_AI_SYNTAX),
  },
  {
    files: ["src/lib/ai/ai-cost-sink.test.ts"],
    rules: fence([SERVICE_ROLE], LIB_AI_SYNTAX),
  },
  {
    files: ["src/lib/ai/ai-cost-sink.ts"],
    rules: fence([], [...NO_SERVER_ACTION, ...LIB_AI_SYNTAX]),
  },
  {
    files: [
      "src/lib/supabase/service-role.ts",
      "src/lib/supabase/service-role.test.ts",
    ],
    rules: fence([AI, AI_PROVIDERS, COST_SINK], LITERAL_IMPORTS_ONLY),
  },
  {
    files: [`src/app/api/**/route.${SOURCE}`],
    rules: fence(
      [AI, AI_PROVIDERS, SERVICE_ROLE],
      [...NO_SERVER_ACTION, ...NO_EXPORT_LIST, ...BASE_SYNTAX],
    ),
  },
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
