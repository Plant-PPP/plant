import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

import { moneyRules } from "../../eslint.money.mjs";
import {
  AI,
  AI_PROVIDERS,
  ALL_FENCED,
  asSelector,
  COST_SINK,
  fenceExcept,
  LITERAL_IMPORTS_ONLY,
  MFA_CALLS,
  MFA_CALLS_BUT_LIST,
  MFA_CALLS_BUT_UNENROLL,
  MFA_PRIVATE_CALLS,
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
// The service-role client, the sink, route handlers, src/lib/ai and
// session-claims.ts export values only through a named declaration, so an
// imported sink, client, model or claims reader cannot be handed on through
// an export list, a default export or CommonJS (module.exports, exports or a
// top-level this).
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
  ...noReexport(ALL_FENCED),
];
const LIB_SYNTAX = [...BASE_SYNTAX, ...NO_EXPORT_LIST];

const webRules = ({ allow = [], syntax, mfaFence = MFA_CALLS }) =>
  fenceExcept(allow, [...syntax, ...mfaFence, ...MFA_PRIVATE_CALLS]);

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
  ...[
    `Identifier[name="${READER}"]:not(CallExpression > .callee):not(ImportSpecifier > Identifier)`,
    `ImportSpecifier[imported.name="${READER}"][local.name!="${READER}"]`,
    // import { "readSessionClaims" as r } names it by a string.
    `ImportSpecifier[imported.type="Literal"]`,
    // A module object would carry the function with it.
    `ImportDeclaration[source.value=${asSelector(SESSION_CLAIMS_UNCHECKED.regex)}] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)`,
    `ImportExpression[source.value=${asSelector(SESSION_CLAIMS_UNCHECKED.regex)}]`,
  ].map((selector) => ({
    selector,
    message: `Only call ${READER}; pass its result on, not the function.`,
  })),
];

// session-claims.ts exports getSessionClaims alone, so no other export can
// wrap the unchecked reader without the redirect.
const ONLY_GET_SESSION_CLAIMS = [
  "ExportNamedDeclaration > :matches(FunctionDeclaration, ClassDeclaration)",
  'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name!="getSessionClaims"]',
].map((selector) => ({
  selector,
  message: "session-claims.ts exports only getSessionClaims.",
}));

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
    rules: webRules({ allow: [AI, AI_PROVIDERS], syntax: LIB_SYNTAX }),
  },
  {
    files: ["src/lib/ai/ai-cost-sink.test.ts"],
    rules: webRules({
      allow: [AI, AI_PROVIDERS, COST_SINK],
      syntax: LIB_SYNTAX,
    }),
  },
  {
    files: ["src/lib/ai/ai-cost-sink.ts"],
    rules: webRules({
      allow: [SERVICE_ROLE],
      syntax: [...NO_SERVER_ACTION, ...LIB_SYNTAX],
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
    files: ["src/lib/auth/session-claims-unchecked.ts"],
    rules: webRules({
      syntax: [
        ...BASE_SYNTAX,
        ...noServerAction(
          "The unchecked claims reader would answer a session that has not verified its code.",
        ),
      ],
    }),
  },
  {
    files: ["src/lib/auth/session-claims.ts"],
    rules: webRules({
      allow: [SESSION_CLAIMS_UNCHECKED],
      syntax: [
        ...BASE_SYNTAX,
        ...READER_CALLS_ONLY,
        ...NO_EXPORT_LIST,
        ...ONLY_GET_SESSION_CLAIMS,
      ],
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
      syntax: BASE_SYNTAX,
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
  {
    files: ["src/lib/auth/mfa-disable.ts", "src/lib/auth/mfa-disable.test.ts"],
    rules: webRules({
      syntax: [
        ...BASE_SYNTAX,
        ...noServerAction(
          "unenrollForSession trusts its caller to have run the sensitive gate; a server action here would skip it.",
        ),
      ],
      mfaFence: MFA_CALLS_BUT_UNENROLL,
    }),
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
