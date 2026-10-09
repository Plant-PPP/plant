import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAME_LIMITS } from "./limits";

const PINNING_TESTS = [
  "portfolio_setup_isolation_test.sql",
  "holders_accounts_isolation_test.sql",
];

// The pgTAP files pin each CHECK as Postgres renders it; this reads the upper
// bound of every char_length in those pins.
function checkedLimits() {
  const sql = PINNING_TESTS.map((file) =>
    readFileSync(
      join(__dirname, "../../../../../supabase/tests", file),
      "utf8",
    ),
  ).join("\n");
  const limits: Record<string, Record<string, number>> = {};
  for (const [, table = "", column = "", max = ""] of sql.matchAll(
    /(\w+) CHECK .*?char_length\((\w+)\) <= (\d+)/g,
  )) {
    const columns = (limits[table] ??= {});
    expect(columns[column]).toBeUndefined();
    columns[column] = Number(max);
  }
  return limits;
}

test("NAME_LIMITS matches the CHECKs the database tests pin", () => {
  expect(checkedLimits()).toEqual(NAME_LIMITS);
});
