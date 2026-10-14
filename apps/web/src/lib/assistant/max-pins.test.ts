import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PINS } from "./chat";

const MIGRATIONS = join(__dirname, "../../../../../supabase/migrations");

// The limit the newest migration that writes private.pinned_charts_limit
// holds.
function databaseLimit() {
  const sql = readdirSync(MIGRATIONS)
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
    .filter((text) => /FUNCTION private\.pinned_charts_limit\(\)/.test(text))
    .at(-1);
  const limit = sql?.match(/count\(\*\) FROM public\.pinned_charts .*>= (\d+)/);
  return limit ? Number(limit[1]) : undefined;
}

test("MAX_PINS matches the limit the database holds", () => {
  expect(databaseLimit()).toBe(MAX_PINS);
});
