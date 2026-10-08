// Cases for the import fences in apps/web/eslint.config.mjs: who may reach a
// model, the cost sink and the secret key. Each source is linted in memory
// under the path it would have in apps/web.
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
async function fenced(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
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
  ["src/lib/ai/ai-cost-sink.ts", '"use server";\nexport const x = 1;'],
  [
    "src/lib/ai/ai-cost-sink.ts",
    'export async function f() {\n  "use server";\n}',
  ],
];

for (const [filePath, code] of flagged) {
  test(`${filePath}: ${code} is fenced`, async () => {
    assert.notDeepEqual(await fenced(filePath, code), []);
  });
}

const allowed = [
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
];

for (const [filePath, code] of allowed) {
  test(`${filePath}: ${code} is allowed`, async () => {
    assert.deepEqual(await fenced(filePath, code), []);
  });
}
