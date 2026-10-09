import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

import { moneyRules } from "../../eslint.money.mjs";
import {
  AI,
  AI_PROVIDERS,
  asSelector,
  COST_SINK,
  fence,
  LITERAL_IMPORTS_ONLY,
  MFA_CALLS,
  MFA_CALLS_BUT_LIST,
  secretKeyReads,
  SERVICE_ROLE,
  SESSION_CLAIMS_UNCHECKED,
  SOURCE,
} from "../../eslint.fences.mjs";

// A module allowed to import a fenced one may not re-export it.
const noReexport = (modules) =>
  modules.flatMap(({ regex, message }) =>
    [
      "ExportAllDeclaration",
      'ExportNamedDeclaration:has(> ExportSpecifier[exportKind!="type"])',
    ].map((node) => ({
      selector: `${node}[exportKind!="type"][source.value=${asSelector(regex)}]`,
      message,
    })),
  );
// The service-role client, the sink, route handlers and src/lib/ai export
// values only through a named declaration, so an imported sink, client or
// model cannot be handed on through an export list, a default export or
// CommonJS (module.exports, exports or a top-level this).
const NO_EXPORT_LIST = [
  'ExportNamedDeclaration:not([source]):not([exportKind="type"]) > ExportSpecifier:not([exportKind="type"])',
  "ExportDefaultDeclaration",
  'MemberExpression[object.name="module"]',
  'Identifier[name="exports"]:not(MemberExpression > .property):not(Property > .key)',
  "ThisExpression:not(:function ThisExpression):not(PropertyDefinition ThisExpression):not(StaticBlock ThisExpression)",
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

// Every module fence of the web app. A block names the ones it may import and
// keeps the rest, so an override cannot drop a fence by leaving it out (a
// later block replaces a rule's whole options).
const WEB_FENCES = [
  AI,
  AI_PROVIDERS,
  SERVICE_ROLE,
  COST_SINK,
  SESSION_CLAIMS_UNCHECKED,
];
// `mfaFence` is the MFA API fence of the block's files.
const webRules = ({ allow = [], syntax, mfaFence = MFA_CALLS }) =>
  fence(
    WEB_FENCES.filter((module) => !allow.includes(module)),
    [...syntax, ...mfaFence],
  );

const noServerAction = (message) =>
  ["Program", ":function > BlockStatement"].map((parent) => ({
    selector: `${parent} > ExpressionStatement[directive][expression.value="use server"]`,
    message,
  }));
const NO_SERVER_ACTION = noServerAction(
  "The cost sink writes rows for any user_id; a server action would make it a public endpoint.",
);

// The files that may import the unchecked claims reader only call it: a
// server action there would read an aal1 session's claims, and a value
// handed on would reach a file the fence keeps it from.
const READER = "readSessionClaims";
const READER_CALLS_ONLY = [
  ...noServerAction(
    "This file reads claims without the MFA redirect; a server action here would accept a session that has not verified its code.",
  ),
  ...noReexport([SESSION_CLAIMS_UNCHECKED]),
  ...[
    `Identifier[name="${READER}"]:not(CallExpression > .callee):not(ImportSpecifier > Identifier)`,
    `ImportSpecifier[imported.name="${READER}"][local.name!="${READER}"]`,
  ].map((selector) => ({
    selector,
    message: `Only call ${READER}; pass its result on, not the function.`,
  })),
];

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
    rules: webRules({ syntax: BASE_SYNTAX }),
  },
  {
    files: [`src/lib/ai/**/*.${SOURCE}`],
    rules: webRules({ allow: [AI, AI_PROVIDERS], syntax: LIB_AI_SYNTAX }),
  },
  {
    files: ["src/lib/ai/ai-cost-sink.test.ts"],
    rules: webRules({
      allow: [AI, AI_PROVIDERS, COST_SINK],
      syntax: LIB_AI_SYNTAX,
    }),
  },
  {
    files: ["src/lib/ai/ai-cost-sink.ts"],
    rules: webRules({
      allow: [AI, AI_PROVIDERS, SERVICE_ROLE, COST_SINK],
      syntax: [...NO_SERVER_ACTION, ...LIB_AI_SYNTAX],
    }),
  },
  {
    files: [
      "src/lib/supabase/service-role.ts",
      "src/lib/supabase/service-role.test.ts",
    ],
    rules: webRules({
      allow: [SERVICE_ROLE],
      syntax: [
        ...LITERAL_IMPORTS_ONLY,
        ...noReexport([SERVICE_ROLE]),
        ...NO_EXPORT_LIST,
      ],
    }),
  },
  {
    files: [`src/app/api/**/route.${SOURCE}`],
    rules: webRules({
      allow: [COST_SINK],
      syntax: [...NO_SERVER_ACTION, ...NO_EXPORT_LIST, ...BASE_SYNTAX],
    }),
  },
  {
    files: ["src/lib/auth/session-claims.ts"],
    rules: webRules({
      allow: [SESSION_CLAIMS_UNCHECKED],
      syntax: [...BASE_SYNTAX, ...READER_CALLS_ONLY, ...NO_EXPORT_LIST],
    }),
  },
  {
    files: ["src/app/auth/mfa/page.tsx"],
    rules: webRules({
      allow: [SESSION_CLAIMS_UNCHECKED],
      syntax: [...BASE_SYNTAX, ...READER_CALLS_ONLY],
    }),
  },
  {
    files: [
      "src/lib/auth/session-claims.test.ts",
      "src/app/auth/mfa/page.test.tsx",
    ],
    rules: webRules({
      allow: [SESSION_CLAIMS_UNCHECKED],
      syntax: [...BASE_SYNTAX, ...noReexport([SESSION_CLAIMS_UNCHECKED])],
    }),
  },
  {
    files: ["src/lib/auth/mfa-browser.ts", "src/lib/auth/mfa-browser.test.ts"],
    rules: webRules({ syntax: BASE_SYNTAX, mfaFence: [] }),
  },
  {
    files: ["src/lib/auth/mfa-factors.ts", "src/lib/auth/mfa-factors.test.ts"],
    rules: webRules({ syntax: BASE_SYNTAX, mfaFence: MFA_CALLS_BUT_LIST }),
  },
  globalIgnores([
    ".next/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
  // eslint-config-next ignores build/, which git does not ignore here and tsc
  // compiles.
  globalIgnores(["!build/**"]),
]);
