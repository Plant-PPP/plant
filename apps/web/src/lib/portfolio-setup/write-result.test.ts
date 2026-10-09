import { WRITE_MESSAGES } from "./messages";
import { toWriteResult } from "./write-result";

const failure = (code: string) => ({ code, mayHaveCommitted: false });

test.each([
  ["PT409", "last_active_portfolio", "last_active_portfolio"],
  ["PT409", "some_other_guard", "failed"],
  ["PT409", undefined, "failed"],
  ["23505", "Key (user_id, lower(name))=(…, mía)", "duplicate_name"],
  ["23503", undefined, "not_found"],
  ["42501", undefined, "failed"],
  ["PGRST116", undefined, "failed"],
  ["fetch_error", undefined, "failed"],
  ["http_502", undefined, "failed"],
])("%s with hint %j is %s", (code, hint, expected) => {
  expect(toWriteResult(failure(code), hint)).toBe(expected);
});

test("every result has its copy", () => {
  for (const message of Object.values(WRITE_MESSAGES)) {
    expect(message.trim()).not.toBe("");
  }
});
