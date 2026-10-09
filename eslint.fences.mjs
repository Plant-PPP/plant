// Import and secret-key fences shared by the web app, packages/* and
// security-tests.

// Every source extension, so no file skips the fences.
export const SOURCE = "{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

// The Supabase secret key bypasses RLS: only
// apps/web/src/lib/supabase/service-role.ts (and its test) may name it.
const SECRET_KEY = "/^(NEXT_PUBLIC_)?SUPABASE_SERVICE_ROLE_KEY$/";

export const secretKeyReads = [
  `Identifier[name=${SECRET_KEY}]`,
  `Literal[value=${SECRET_KEY}]`,
  `TemplateElement[value.cooked=${SECRET_KEY}]`,
].map((selector) => ({
  selector,
  message:
    "Only apps/web/src/lib/supabase/service-role.ts names SUPABASE_SERVICE_ROLE_KEY.",
}));

// Who may reach a model, the secret key and the unchecked claims reader. Each
// fenced module is a regex over the import specifier, with or without a file
// extension, query or hash.
const EXTENSION = String.raw`(\.[cm]?[jt]sx?)?([?#].*)?`;
const AI_MESSAGE =
  "Only apps/web/src/lib/ai, except the cost sink, may call a model, so every call is costed.";
export const AI = { regex: "^ai([/?#].*)?$", message: AI_MESSAGE };
export const AI_PROVIDERS = {
  regex: "^@ai-sdk/(?!react(/|$))",
  message: AI_MESSAGE,
};
export const SERVICE_ROLE = {
  regex: `(^|/)service-role${EXTENSION}$`,
  message:
    "The secret key bypasses RLS; only the AI cost sink and the quote sink hold it.",
};
export const COST_SINK = {
  regex: `(^|/)ai-cost-sink${EXTENSION}$`,
  message:
    "The cost sink writes past RLS; only route handlers under src/app/api may use it.",
};
export const QUOTE_SINK = {
  regex: `(^|/)quote-sink${EXTENSION}$`,
  message:
    "The quote sink writes rows every user reads, past RLS; only the Inngest route may use it.",
};

// /auth/mfa reads claims without the MFA redirect; everything else must get
// the redirect through getSessionClaims.
export const SESSION_CLAIMS_UNCHECKED = {
  regex: `(^|/)session-claims-unchecked${EXTENSION}$`,
  message:
    "Read claims through getSessionClaims, which sends an unverified MFA session to /auth/mfa.",
};

// The modules a block can be allowed to import. Every web block fences each
// one it does not allow (through fenceExcept) and every package fences them
// all, so a new fence goes here; fence() also bans node_modules paths and
// Inngest's model packages in every block.
export const ALL_FENCED = [
  AI,
  AI_PROVIDERS,
  SERVICE_ROLE,
  COST_SINK,
  QUOTE_SINK,
  SESSION_CLAIMS_UNCHECKED,
];

// A path into node_modules reaches a package without naming it.
const NODE_MODULES = {
  regex: "(^|/)node_modules(/|$)",
  message: "Import a package by its name, so the import fences see it.",
};

// Inngest's step.ai and @inngest/agent-kit call a model themselves, past the
// cost middleware; inngest re-exports @inngest/ai's model helpers for step.ai.
const INNGEST_AI = {
  regex: "^@inngest/(ai|agent-kit)([/?#]|$)",
  message:
    "Models are called only through src/lib/ai, which records their cost.",
};
const CAST =
  ":matches(TSAsExpression, TSSatisfiesExpression, TSNonNullExpression, TSTypeAssertion)";
// A property or destructured key named `name`, written bare, quoted or as a
// template literal, or quoted inside any number of type casts.
const named = (node, key, name) => [
  `${node}[${key}.name="${name}"]`,
  `${node}[${key}.value="${name}"]`,
  `${node}[${key}.quasis.0.value.cooked="${name}"]`,
  ...[
    `[expression.value="${name}"]`,
    `[expression.quasis.0.value.cooked="${name}"]`,
  ].map(
    (inner) =>
      `${node}[computed=true] > ${CAST}.${key}:matches(${inner}, :has(${CAST}${inner}))`,
  ),
];
const STEP_AI = [
  ...named("MemberExpression", "property", "ai"),
  ...named("ObjectPattern > Property", "key", "ai"),
].map((selector) => ({ selector, message: INNGEST_AI.message }));

// Enroll, challenge and verify run in the browser (Auth rate-limits them per
// caller IP); on the server the factor helpers only list and mfa-disable.ts
// only unenrolls: no other file reads `mfa` off an Auth client.
const MFA_MEMBER = named("MemberExpression", "property", "mfa");
const MFA_PATTERN = named("ObjectPattern > Property", "key", "mfa");
export const MFA_CALLS = [...MFA_MEMBER, ...MFA_PATTERN].map((selector) => ({
  selector,
  message:
    "Call Auth's MFA API only through src/lib/auth/mfa-browser.ts, mfa-factors.ts or mfa-disable.ts.",
}));
// A server-side file that may call one MFA method, written `….mfa.<method>`.
// The first MFA_MEMBER selector is the bare `.mfa`.
const mfaCallsBut = (method, message) =>
  [
    `${MFA_MEMBER[0]}:not(MemberExpression[property.name="${method}"] > .object)`,
    ...MFA_MEMBER.slice(1),
    ...MFA_PATTERN,
  ].map((selector) => ({ selector, message }));
export const MFA_CALLS_BUT_LIST = mfaCallsBut(
  "listFactors",
  "mfa-factors.ts also runs on the server: it only lists factors. Enroll, challenge and verify go in mfa-browser.ts.",
);
export const MFA_CALLS_BUT_UNENROLL = mfaCallsBut(
  "unenroll",
  "mfa-disable.ts runs on the server behind the sensitive gate: it only unenrolls. Enroll, challenge and verify go in mfa-browser.ts.",
);

// auth-js's private methods behind the MFA API and its recovery codes (2.117),
// reachable by a quoted key.
const PRIVATE_MFA = [
  "_enroll",
  "_challenge",
  "_verify",
  "_challengeAndVerify",
  "_unenroll",
  "_listFactors",
  "_getAuthenticatorAssuranceLevel",
  "_getRecoveryCodesStatus",
  "_generateRecoveryCodes",
  "_verifyRecoveryCode",
  "_regenerateRecoveryCodes",
  "_unenrollRecoveryCodes",
];
export const MFA_PRIVATE_CALLS = PRIVATE_MFA.flatMap((name) => [
  ...named("MemberExpression", "property", name),
  ...named("ObjectPattern > Property", "key", name),
]).map((selector) => ({
  selector,
  message: "Call Auth's MFA API through its public methods in mfa-browser.ts.",
}));

// The fences read import specifiers, so a computed one, a bundler's
// require.context or import.meta other than .url, .dirname and .filename
// (import.meta.webpackContext), or a require wrapped in a type cast (which the
// fences' callee match misses), cannot pass them.
export const LITERAL_IMPORTS_ONLY = [
  'ImportExpression[source.type!="Literal"]',
  'CallExpression[callee.name="require"][arguments.0.type!="Literal"]',
  `${CAST}[expression.name="require"]`,
  ...named(
    'MemberExpression:has(Identifier[name="require"])',
    "property",
    "context",
  ),
  'MetaProperty[meta.name="import"]:not(MemberExpression[computed=false][property.name=/^(url|dirname|filename)$/] > .object)',
].map((selector) => ({
  selector,
  message: "Import a module by a string literal so the import fences see it.",
}));

export const asSelector = (regex) => `/${regex.replaceAll("/", "\\/")}/`;

// The rules for one config block: `fenced` lists the modules it may not
// import, each a regex over the import specifier, on top of node_modules paths
// and Inngest's model calls, which no block may use. A later block replaces a
// rule's options, so each lists everything it keeps. no-restricted-imports
// does not see import() or require(), so the same regexes go to
// no-restricted-syntax.
export function fence(fenced, syntax) {
  const modules = [...fenced, NODE_MODULES, INNGEST_AI];
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
      ...STEP_AI,
      ...syntax,
    ],
  };
}

// A block names the modules it may import and keeps the rest fenced, so an
// override cannot drop a fence by leaving it out.
export const fenceExcept = (allowed, syntax) =>
  fence(
    ALL_FENCED.filter((module) => !allowed.includes(module)),
    syntax,
  );
