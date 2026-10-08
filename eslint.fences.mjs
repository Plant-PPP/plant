// Import and secret-key fences shared by the web app, packages/* and
// security-tests.

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

// The fences read import specifiers, so a computed one cannot pass them.
export const LITERAL_IMPORTS_ONLY = [
  'ImportExpression[source.type!="Literal"]',
  'CallExpression[callee.name="require"][arguments.0.type!="Literal"]',
].map((selector) => ({
  selector,
  message: "Import a module by a string literal so the import fences see it.",
}));

export const asSelector = (regex) => `/${regex.replaceAll("/", "\\/")}/`;

// The rules for one config block: `fenced` lists the modules it may not
// import, each a regex over the import specifier. A later block replaces a
// rule's options, so each lists everything it keeps. no-restricted-imports
// does not see import() or require(), so the same regexes go to
// no-restricted-syntax.
export function fence(fenced, syntax) {
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
