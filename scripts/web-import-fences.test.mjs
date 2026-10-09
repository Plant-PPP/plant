// Cases for the import fences in apps/web/eslint.config.mjs: who may reach a
// model, the cost sink and the secret key. Each source is linted in memory
// under the path it would have in apps/web, and the package fences
// (eslint.packages.mjs) under every package that uses them.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const { ESLint } = createRequire(`${web}package.json`)("eslint");
const eslint = new ESLint({ cwd: web });

const FENCES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

/** The fence rules that fire on `code` linted as `filePath`. */
async function fenced(filePath, code, linter = eslint) {
  const [result] = await linter.lintText(code, { filePath });
  return result.messages
    .filter((message) => FENCES.has(message.ruleId))
    .map((message) => message.ruleId);
}

const flagged = [
  ["src/components/x.tsx", 'import { generateText } from "ai";'],
  ["src/components/x.tsx", 'import { google } from "@ai-sdk/google";'],
  ["src/components/x.tsx", 'export * from "ai";'],
  ["src/components/x.tsx", 'export const f = () => import("ai");'],
  ["src/components/x.js", 'import { generateText } from "ai";'],
  ["src/lib/supabase/x.ts", 'import { generateText } from "ai";'],
  ["src/components/x.tsx", 'import "@ai-sdk/reactor";'],
  ["src/app/api/x/helpers.ts", 'import "@/lib/ai/ai-cost-sink";'],
  [
    "src/app/page.tsx",
    'export const c = require["context"]("../lib/ai", false, /sink/);',
  ],
  [
    "src/app/page.tsx",
    'export const c = require["context" as const]("../lib/ai", false, /sink/);',
  ],
  [
    "src/app/actions.ts",
    '"use server";\nexport const s = (require as NodeRequire)("@/lib/ai/ai-cost-sink");',
  ],
  ["src/app/actions.ts", 'export const s = require!("@/lib/ai/ai-cost-sink");'],
  [
    "src/app/api/x/route.ts",
    'export const f = ({ step }) => step["ai" as const].infer("x", {});',
  ],
  [
    "src/app/api/x/route.ts",
    "export const f = ({ step }) => step[`ai` satisfies string].infer;",
  ],
  ["src/components/x.ts", 'export const s = (<NodeRequire>require)("ai");'],
  [
    "src/components/x.ts",
    'export const s = (require satisfies NodeRequire)("ai");',
  ],
  [
    "src/app/api/x/route.ts",
    'export async function POST() {\n  const f = async () => {\n    "use server";\n  };\n  return f;\n}',
  ],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'export const f = async () => {\n  "use server";\n};',
  ],
  ["src/lib/supabase/service-role.test.ts", 'export * from "./service-role";'],
  [
    "src/lib/supabase/service-role.test.ts",
    'import { createServiceRoleClient } from "./service-role";\nexport { createServiceRoleClient };',
  ],
  ["src/lib/supabase/x.ts", 'import "./service-role";'],
  ["src/lib/supabase/x.ts", 'import "./service-role.js";'],
  ["src/app/page.tsx", 'import "@/lib/supabase/service-role";'],
  [
    "src/app/page.tsx",
    'export const f = () => import("../lib/supabase/service-role.js");',
  ],
  ["src/app/actions.ts", '"use server";\nimport "@/lib/ai/ai-cost-sink";'],
  ["src/app/actions.ts", 'import "@/lib/ai/ai-cost-sink.js";'],
  [
    "src/app/actions.ts",
    'const m = "@/lib/ai/ai-cost-sink";\nexport const f = () => import(m);',
  ],
  [
    "src/app/actions.ts",
    "export const f = () => import(`@/lib/ai/ai-cost-sink`);",
  ],
  ["src/app/page.tsx", 'import "@/lib/supabase/service-role.mjs";'],
  ["src/app/actions.ts", 'import "@/lib/ai/ai-cost-sink.tsx";'],
  ["src/lib/supabase/service-role.ts", 'import "ai";'],
  ["src/lib/supabase/service-role.ts", 'import "@ai-sdk/google";'],
  [
    "src/lib/supabase/service-role.ts",
    'const m = "x";\nexport const f = () => import(m);',
  ],
  ["src/app/api/x/route.ts", 'import { google } from "@ai-sdk/google";'],
  [
    "src/app/api/x/route.ts",
    '"use\\x20server";\nexport async function POST() {}',
  ],
  ["src/lib/ai/ai-cost-sink.ts", '"use\\x20server";\nexport const x = 1;'],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'export async function f() {\n  "use\\x20server";\n}',
  ],
  ...["mjs", "cjs", "mts", "cts", "jsx"].map((ext) => [
    `src/components/x.${ext}`,
    'import "ai";',
  ]),
  ["src/app/api/x/route.mts", 'import "@/lib/supabase/service-role";'],
  [
    "src/app/page.tsx",
    'export const c = (require as any)["context"]("../lib/ai", false, /sink/);',
  ],
  [
    "src/app/page.tsx",
    'export const c = (require as any)[`context`]("../lib/ai", false, /sink/);',
  ],
  [
    "src/lib/ai/x.ts",
    'export const f = (step) => {\n  const { "ai": a } = step;\n  return a;\n};',
  ],
  [
    "src/lib/ai/x.ts",
    'export const f = (step) => {\n  const { ["ai"]: a } = step;\n  return a;\n};',
  ],
  ["src/lib/ai/x.ts", "export const f = (step) => step[`ai`];"],
  ["src/components/x.tsx", 'import { models } from "@inngest/ai/models";'],
  ["src/components/x.tsx", 'import { createAgent } from "@inngest/agent-kit";'],
  ["build/reach.ts", 'import "@/lib/supabase/service-role";'],
  [
    "src/app/api/x/route.ts",
    'export async function POST() {\n  await step.ai.infer("x", {});\n}',
  ],
  [
    "src/lib/ai/x.ts",
    'export const f = ({ step: { ai } }) => ai.infer("x", {});',
  ],
  ["src/lib/ai/x.ts", 'export const f = (step) => step["ai"].wrap("x", f);'],
  ["src/components/x.tsx", 'import { gemini } from "@inngest/ai";'],
  [
    "src/app/actions.ts",
    'export const c = require.context("../lib/ai", false, /sink/);',
  ],
  [
    "src/app/page.tsx",
    'export const c = (require as unknown as { context: Function }).context("../lib", false, /role/);',
  ],
  ...[
    "src/lib/ai/x.ts",
    "src/lib/ai/ai-cost-sink.ts",
    "src/app/api/x/route.ts",
  ].flatMap((filePath) => [
    [filePath, "export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;"],
    [filePath, 'const m = "x";\nexport const f = () => import(m);'],
  ]),
  ["src/lib/ai/x.ts", 'import "@/lib/ai/ai-cost-sink";'],
  ["src/lib/ai/x.ts", 'import "../supabase/service-role";'],
  ["src/app/api/x/route.ts", 'import "@/lib/supabase/service-role";'],
  ["src/app/api/x/route.ts", 'import { generateText } from "ai";'],
  ["src/lib/x.ts", "export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;"],
  [
    "src/lib/x.ts",
    'export const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];',
  ],
  [
    "src/lib/x.ts",
    "const { SUPABASE_SERVICE_ROLE_KEY: k } = process.env;\nexport { k };",
  ],
  [
    "src/lib/x.ts",
    "export const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;",
  ],
  [
    "next.config.ts",
    "export default { env: { K: process.env.SUPABASE_SERVICE_ROLE_KEY } };",
  ],
  ["e2e/x.spec.ts", 'import "../src/lib/supabase/service-role";'],
  [
    "src/app/api/x/route.ts",
    'export { aiCostSink } from "@/lib/ai/ai-cost-sink";',
  ],
  ["src/app/api/x/route.ts", 'export * from "@/lib/ai/ai-cost-sink";'],
  [
    "src/app/api/x/route.ts",
    '"use server";\nimport { aiCostSink } from "@/lib/ai/ai-cost-sink";\nexport async function POST() {}',
  ],
  [
    "src/app/api/x/route.ts",
    'export async function POST() {\n  "use server";\n}',
  ],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'export { createServiceRoleClient } from "@/lib/supabase/service-role";',
  ],
  ["src/app/actions.ts", 'export * from "@/lib/supabase/service-role";'],
  [
    "src/app/api/x/route.ts",
    'import { aiCostSink } from "@/lib/ai/ai-cost-sink";\nexport { aiCostSink };',
  ],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'import { createServiceRoleClient } from "@/lib/supabase/service-role";\nexport { createServiceRoleClient };',
  ],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'import { createServiceRoleClient } from "@/lib/supabase/service-role";\nexport default createServiceRoleClient;',
  ],
  ["src/lib/ai/x.ts", 'export { generateText } from "ai";'],
  ["src/lib/ai/x.ts", 'export * from "@ai-sdk/google";'],
  ["src/lib/ai/ai-cost-sink.ts", '"use server";\nexport const x = 1;'],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'export async function f() {\n  "use server";\n}',
  ],
  [
    "src/lib/ai/x.ts",
    'import { generateText } from "ai";\nexport { generateText };',
  ],
  ["src/lib/ai/x.ts", 'import * as ai from "ai";\nexport { ai };'],
  ["src/lib/ai/ai-cost-sink.ts", 'export * from "ai";'],
  ["src/lib/ai/ai-cost-sink.ts", 'export { generateText } from "ai";'],
  ["src/lib/ai/ai-cost-sink.test.ts", 'import "@/lib/supabase/service-role";'],
  [
    "src/lib/ai/ai-cost-sink.test.ts",
    'import { aiCostSink } from "./ai-cost-sink";\nexport { aiCostSink };',
  ],
  ["src/lib/ai/x.test.ts", 'import "./ai-cost-sink";'],
  ["src/app/auth/callback/route.ts", 'import "@/lib/ai/ai-cost-sink";'],
  ["src/components/x.tsx", 'export const m = require("ai");'],
  ["src/components/x.tsx", 'import "ai/rsc";'],
  [
    "src/components/x.tsx",
    'import { generateText } from "../../node_modules/ai";',
  ],
  ["src/lib/x.ts", 'const m = "ai";\nexport const f = () => require(m);'],
  [
    "src/lib/x.ts",
    "export const k = process.env[`SUPABASE_SERVICE_ROLE_KEY`];",
  ],
  [
    "src/lib/x.ts",
    "export const k = process.env[`SUPABASE_SERVICE_ROLE_\\x4bEY`];",
  ],
  [
    "src/lib/ai/x.ts",
    'import { generateText } from "ai";\nexport default generateText as typeof generateText;',
  ],
  [
    "src/app/api/x/route.ts",
    'import { aiCostSink } from "@/lib/ai/ai-cost-sink";\nexport default { aiCostSink };',
  ],
  ["src/lib/supabase/service-role.test.ts", 'import "@/lib/ai/ai-cost-sink";'],
  ["src/lib/ai/x.cjs", 'module.exports = require("ai");'],
  ["src/lib/ai/y.ts", 'module.exports = require("ai");'],
  ["src/lib/ai/x.cjs", 'exports.generateText = require("ai").generateText;'],
  ["src/lib/ai/z.cjs", 'this.generateText = require("ai").generateText;'],
  [
    "src/app/api/x/route.cjs",
    'module.exports = require("../../../lib/ai/ai-cost-sink");',
  ],
  [
    "src/lib/ai/ai-cost-sink.test.ts",
    'module.exports = require("./ai-cost-sink");',
  ],
];

// Only /auth/mfa reads claims without the MFA redirect, and only the factor
// helpers call Auth's MFA API.
const READER =
  'import { readSessionClaims } from "@/lib/auth/session-claims-unchecked";';
flagged.push(
  ["src/app/(app)/page.tsx", READER],
  ["src/app/api/x/route.ts", READER],
  ["src/lib/ai/x.ts", READER],
  ["src/app/auth/mfa/actions.ts", READER],
  [
    "src/lib/auth/session-claims.ts",
    'export { readSessionClaims } from "./session-claims-unchecked";',
  ],
  [
    "src/app/auth/mfa/page.tsx",
    'const m = "@/lib/auth/session-claims-unchecked";\nexport const f = () => import(m);',
  ],
  [
    "src/app/(app)/settings/actions.ts",
    "export const f = (s) => s.auth.mfa.verify({ factorId: 'f', code: '1' });",
  ],
  [
    "src/components/mfa/x.tsx",
    "export const f = (s) => s.auth.mfa.unenroll({ factorId: 'f' });",
  ],
  [
    "src/components/mfa/x.tsx",
    "export const f = (supabase) => {\n  const { mfa } = supabase.auth;\n  return mfa;\n};",
  ],
  ["src/components/mfa/x.tsx", 'export const f = (s) => s.auth["mfa"].enroll;'],
  [
    "src/lib/auth/session-claims.ts",
    `${READER}\nexport { readSessionClaims };`,
  ],
  [
    "src/lib/auth/session-claims.ts",
    `${READER}\nexport const r = readSessionClaims;`,
  ],
  [
    "src/app/auth/mfa/page.tsx",
    `${READER}\nexport { readSessionClaims };`,
  ],
  [
    "src/app/auth/mfa/page.tsx",
    'import { readSessionClaims as r } from "@/lib/auth/session-claims-unchecked";\nexport const f = () => r();',
  ],
  [
    "src/app/auth/mfa/page.tsx",
    `"use server";\n${READER}\nexport async function act() {\n  return readSessionClaims();\n}`,
  ],
  [
    "src/app/auth/mfa/page.tsx",
    `${READER}\nexport default function Page() {\n  async function act() {\n    "use server";\n    return readSessionClaims();\n  }\n  return act;\n}`,
  ],
  [
    "src/lib/auth/session-claims.ts",
    'import * as u from "./session-claims-unchecked";\nexport const r = u;',
  ],
  [
    "src/app/auth/mfa/page.tsx",
    'import * as u from "@/lib/auth/session-claims-unchecked";\nexport const f = () => u["readSessionClaims"];',
  ],
  [
    "src/lib/auth/session-claims.ts",
    'export const load = () => import("./session-claims-unchecked");',
  ],
  [
    "src/lib/auth/mfa-factors.ts",
    "export const f = (s) => s.auth.mfa.enroll({ factorType: 'totp' });",
  ],
  [
    "src/lib/auth/mfa-factors.ts",
    "export const f = (s) => {\n  const { mfa } = s.auth;\n  return mfa.listFactors();\n};",
  ],
  ["src/lib/auth/mfa-factors.ts", "export const f = (s) => s.auth.mfa;"],
  [
    "src/lib/auth/mfa-factors.test.ts",
    "export const f = (s) => s.auth.mfa.unenroll({ factorId: 'f' });",
  ],
);

for (const [filePath, code] of flagged) {
  test(`${filePath}: ${code} is fenced`, async () => {
    assert.notDeepEqual(await fenced(filePath, code), []);
  });
}

const allowed = [
  ["src/lib/x.ts", 'import "./service-roles";'],
  ["src/components/x.tsx", 'import { useChat } from "@ai-sdk/react";'],
  [
    "src/lib/ai/x.ts",
    'import { generateText } from "ai";\nimport { google } from "@ai-sdk/google";',
  ],
  [
    "src/app/api/inngest/route.ts",
    'import { aiCostSink } from "@/lib/ai/ai-cost-sink";\nimport { costMiddleware } from "@/lib/ai/cost-middleware";',
  ],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'import { createServiceRoleClient } from "@/lib/supabase/service-role";',
  ],
  [
    "src/lib/supabase/service-role.ts",
    "export const key = process.env.SUPABASE_SERVICE_ROLE_KEY;",
  ],
  ["src/instrumentation.ts", 'export const f = () => import("@vercel/otel");'],
  [
    "src/app/api/inngest/route.ts",
    'import { serveOptions } from "@plant/jobs";\nimport { serve } from "inngest/next";\nexport const { GET, POST, PUT } = serve(serveOptions);',
  ],
  [
    "src/lib/ai/ai-cost-sink.test.ts",
    'import { aiCostSink } from "./ai-cost-sink";\nexport const s = aiCostSink;',
  ],
  [
    "src/app/api/x/route.ts",
    'import { aiCostSink } from "@/lib/ai/ai-cost-sink";\nexport async function POST() {\n  aiCostSink();\n  return new Response();\n}',
  ],
  ["src/app/api/x/route.ts", "type T = string;\nexport type { T };"],
  ["src/lib/ai/x.ts", "type T = string;\nexport type { T };"],
  ["src/lib/ai/x.ts", "type T = string;\nexport { type T };"],
  ["src/lib/ai/x.ts", 'export type { LanguageModel } from "ai";'],
  ["src/app/api/x/route.ts", 'export type * from "@/lib/ai/ai-cost-sink";'],
  [
    "src/lib/supabase/service-role.test.ts",
    'import "./service-role";\nprocess.env.SUPABASE_SERVICE_ROLE_KEY = "k";',
  ],
  ["src/lib/ai/x.ts", 'export { type LanguageModel } from "ai";'],
  ["src/app/api/x/route.ts", 'export { type X } from "@/lib/ai/ai-cost-sink";'],
  [
    "src/app/api/a/b/route.ts",
    'import { aiCostSink } from "@/lib/ai/ai-cost-sink";\nexport async function POST() {\n  aiCostSink();\n  return new Response();\n}',
  ],
  ["src/lib/x.ts", "export const f = (o: { aim: number }) => o.aim;"],
  ["src/lib/ai/ai-cost-sink.ts", 'export const s = "use server";'],
  [
    "src/app/api/x/route.js",
    'import { aiCostSink } from "@/lib/ai/ai-cost-sink";\nexport async function POST() {\n  aiCostSink();\n  return new Response();\n}',
  ],
  [
    "src/lib/ai/x.ts",
    "export class C {\n  a = 1;\n  b = this.a;\n  static {\n    this.name;\n  }\n  f() {\n    return this.a;\n  }\n}",
  ],
  [
    "src/lib/ai/x.ts",
    "export const o = { exports: 1 };\nexport const e = o.exports;",
  ],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'export function f() {\n  f();\n  "use server";\n}',
  ],
];

allowed.push(
  ["src/lib/auth/session-claims.ts", READER],
  ["src/lib/auth/session-claims.test.ts", READER],
  ["src/app/auth/mfa/page.tsx", READER],
  ["src/app/auth/mfa/page.test.tsx", READER],
  [
    "src/lib/auth/mfa-browser.ts",
    "export const f = (s) => s.auth.mfa.enroll({ factorType: 'totp' });",
  ],
  [
    "src/lib/auth/mfa-factors.ts",
    "export const f = (s) => s.auth.mfa.listFactors();",
  ],
  ["src/lib/x.ts", "export const f = (c) => c.mfa_enrolled;"],
  [
    "src/lib/auth/session-claims.ts",
    `${READER}\nexport const getSessionClaims = async () => readSessionClaims();`,
  ],
  [
    "src/app/auth/mfa/page.tsx",
    `${READER}\nexport default async function Page() {\n  await readSessionClaims();\n  return null;\n}`,
  ],
  [
    "src/app/auth/mfa/page.test.tsx",
    'jest.mock("@/lib/auth/session-claims-unchecked", () => ({\n  readSessionClaims: () => null,\n}));',
  ],
);

for (const [filePath, code] of allowed) {
  test(`${filePath}: ${code} is allowed`, async () => {
    assert.deepEqual(await fenced(filePath, code), []);
  });
}

// Each override replaces the global block's rules for its files, so it must
// carry every fence it does not exempt.
const OVERRIDES = [
  ["src/lib/ai/x.ts", []],
  ["src/lib/ai/ai-cost-sink.ts", []],
  ["src/lib/ai/ai-cost-sink.test.ts", []],
  ["src/lib/supabase/service-role.ts", []],
  ["src/app/api/x/route.ts", []],
  ["src/lib/auth/session-claims.ts", ["reader"]],
  ["src/lib/auth/session-claims.test.ts", ["reader"]],
  ["src/app/auth/mfa/page.tsx", ["reader"]],
  ["src/app/auth/mfa/page.test.tsx", ["reader"]],
  ["src/lib/auth/mfa-browser.ts", ["mfa"]],
  ["src/lib/auth/mfa-browser.test.ts", ["mfa"]],
  ["src/lib/auth/mfa-factors.ts", []],
  ["src/lib/auth/mfa-factors.test.ts", []],
];
const PROBES = {
  reader: READER,
  mfa: "export const f = (s) => s.auth.mfa.challenge({ factorId: 'f' });",
  service: 'import "@/lib/supabase/service-role";',
  ai: 'import { generateText } from "ai";',
  sink: 'import "@/lib/ai/ai-cost-sink";',
  dynamic: 'const m = "ai";\nexport const f = () => import(m);',
};
for (const [filePath, exempt] of OVERRIDES) {
  for (const [probe, code] of Object.entries(PROBES)) {
    if (exempt.includes(probe)) continue;
    // Each block's own allowances: src/lib/ai reaches models, the sink and
    // its test reach the sink, and the sink and service-role.ts the client.
    if (probe === "ai" && filePath.startsWith("src/lib/ai/")) continue;
    if (probe === "sink" && /ai-cost-sink|route\.ts$/.test(filePath)) continue;
    if (probe === "service" && /service-role|ai-cost-sink\.ts/.test(filePath)) {
      continue;
    }
    test(`${filePath} keeps the ${probe} fence`, async () => {
      assert.notDeepEqual(await fenced(filePath, code), []);
    });
  }
}

const jobs = new ESLint({
  cwd: fileURLToPath(new URL("../packages/jobs/", import.meta.url)),
});

for (const code of [
  'import "../../node_modules/.pnpm/node_modules/ai";',
  'export const f = () => import("../../../apps/web/src/lib/ai/ai-cost-sink");',
  'const m = "x";\nexport const f = () => import(m);',
  'export const f = ({ step }) => step.ai.infer("x", {});',
  'import { gemini } from "@inngest/ai";',
  'import { createAgent } from "@inngest/agent-kit";',
  'export const c = require.context("../../../apps/web/src/lib/supabase", false, /role/);',
  'export const s = (require as NodeRequire)("../../../apps/web/src/lib/ai/ai-cost-sink");',
  'export const f = ({ step }) => step["ai" as const].infer("x", {});',
  'export const f = ({ step }) => { const { ["ai" as const]: m } = step; return m; };',
  'export const f = ({ step }) => step["ai" as unknown as "ai"].infer("x", {});',
  'export const f = ({ step }) => { const { ["ai" as unknown as "ai"]: m } = step; return m; };',
  'export const f = ({ step }) => step["ai" satisfies string as "ai"].infer;',
]) {
  test(`packages/jobs: ${code} is flagged`, async () => {
    assert.notDeepEqual(await fenced("src/x.ts", code, jobs), []);
  });
}

// Files outside src/ and config files are fenced too.
for (const filePath of ["lib/x.ts", "x.config.mjs"]) {
  test(`packages/jobs: import "ai" in ${filePath} is flagged`, async () => {
    assert.notDeepEqual(await fenced(filePath, 'import "ai";', jobs), []);
  });
}

// Every package that shares eslint.packages.mjs, at its own depth.
for (const [dir, up] of [
  ["packages/core", "../../.."],
  ["packages/jobs", "../../.."],
  ["packages/shared", "../../.."],
  ["packages/sources", "../../.."],
  ["security-tests", "../.."],
]) {
  const lint = new ESLint({
    cwd: fileURLToPath(new URL(`../${dir}/`, import.meta.url)),
  });
  for (const code of [
    "export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;",
    `import "${up}/apps/web/src/lib/supabase/service-role";`,
    `import "${up}/apps/web/node_modules/ai";`,
    'import "ai";',
    'import "@ai-sdk/google";',
    'import "@ai-sdk/react";',
    'import "./web/supabase/service-role";',
    'import "./web/ai/ai-cost-sink";',
    `import "${up}/apps/web/src/lib/supabase/server";`,
  ]) {
    for (const ext of ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]) {
      test(`${dir}: ${code} in a .${ext} file is flagged`, async () => {
        assert.notDeepEqual(await fenced(`src/x.${ext}`, code, lint), []);
      });
    }
  }
}

test("packages/jobs: its own and workspace imports are allowed", async () => {
  const [result] = await jobs.lintText(
    'import "./client";\nimport "@plant/shared";\nimport "inngest";',
    { filePath: "src/x.ts" },
  );
  assert.deepEqual(result.messages, []);
});
