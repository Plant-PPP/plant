import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

import { moneyRules } from "../../eslint.money.mjs";

const AI_MESSAGE = "Only src/lib/ai may call a model, so every call is costed.";
const AI = { name: "ai", message: AI_MESSAGE };
const AI_PATTERNS = ["^ai/", "^@ai-sdk/(?!react(/|$))"].map((regex) => ({
  regex,
  message: AI_MESSAGE,
}));
const SERVICE_ROLE = {
  regex: "(^|/)service-role$",
  message: "The secret key bypasses RLS; only the AI cost sink holds it.",
};
const COST_SINK = {
  regex: "(^|/)ai-cost-sink$",
  message: "The cost sink writes past RLS; only route handlers may use it.",
};

const UI_BANNED =
  /^(ai(\/.*)?|@ai-sdk\/(?!react(\/|$)).*|.*(^|\/)(service-role|ai-cost-sink))$/;
const AI_LIB_BANNED = /(^|\/)(service-role|ai-cost-sink)$/;
const ROUTE_BANNED =
  /^(ai(\/.*)?|@ai-sdk\/(?!react(\/|$)).*|.*(^|\/)service-role)$/;

// no-restricted-imports does not see import() or require().
function dynamicImports(banned) {
  const source = `/${banned.source}/`;
  return [
    {
      selector: `ImportExpression[source.value=${source}]`,
      message: "This module may not be imported here.",
    },
    {
      selector: `CallExpression[callee.name="require"][arguments.0.value=${source}]`,
      message: "This module may not be imported here.",
    },
  ];
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: moneyRules },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/log/server-log.ts"],
    rules: { "no-console": "error" },
  },
  // Who may reach a model and the secret key. A later block replaces the
  // rule's options, so each lists everything it keeps.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [AI], patterns: [...AI_PATTERNS, SERVICE_ROLE, COST_SINK] },
      ],
      "no-restricted-syntax": ["error", ...dynamicImports(UI_BANNED)],
    },
  },
  {
    files: ["src/lib/ai/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [SERVICE_ROLE, COST_SINK] },
      ],
      "no-restricted-syntax": ["error", ...dynamicImports(AI_LIB_BANNED)],
    },
  },
  {
    files: ["src/lib/ai/ai-cost-sink.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": [
        "error",
        ...["Program", ":function > BlockStatement"].map((parent) => ({
          selector: `${parent} > ExpressionStatement[directive="use server"]`,
          message:
            "The cost sink writes rows for any user_id; a server action would make it a public endpoint.",
        })),
      ],
    },
  },
  {
    files: ["src/app/api/**/route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [AI], patterns: [...AI_PATTERNS, SERVICE_ROLE] },
      ],
      "no-restricted-syntax": ["error", ...dynamicImports(ROUTE_BANNED)],
    },
  },
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
