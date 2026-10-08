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

// A path into node_modules reaches a package without naming it.
const NODE_MODULES = {
  regex: "(^|/)node_modules(/|$)",
  message: "Import a package by its name, so the import fences see it.",
};

// Inngest's step.ai and @inngest/agent-kit call a model themselves, past the
// cost middleware; inngest re-exports @inngest/ai's model helpers for step.ai.
const INNGEST_AI = {
  regex: "^@inngest/(ai|agent-kit)(/|$)",
  message:
    "Models are called only through src/lib/ai, which records their cost.",
};
// A property or destructured key named `name`, written bare, quoted or as a
// template literal.
const named = (node, key, name) => [
  `${node}[${key}.name="${name}"]`,
  `${node}[${key}.value="${name}"]`,
  `${node}[${key}.quasis.0.value.cooked="${name}"]`,
];
const STEP_AI = [
  ...named("MemberExpression", "property", "ai"),
  ...named("ObjectPattern > Property", "key", "ai"),
].map((selector) => ({ selector, message: INNGEST_AI.message }));

// The fences read import specifiers, so a computed one, a bundler's
// require.context, or a require wrapped in a type cast (which the fences'
// callee match misses), cannot pass them.
export const LITERAL_IMPORTS_ONLY = [
  'ImportExpression[source.type!="Literal"]',
  'CallExpression[callee.name="require"][arguments.0.type!="Literal"]',
  ':matches(TSAsExpression, TSSatisfiesExpression, TSNonNullExpression, TSTypeAssertion)[expression.name="require"]',
  ...named("MemberExpression", "property", "context").map(
    (node) => `${node}:has(Identifier[name="require"])`,
  ),
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
