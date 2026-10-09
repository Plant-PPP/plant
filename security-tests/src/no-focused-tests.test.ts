import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FOCUS_OR_SKIP =
  /\b(?:describe|test|it)(?:\.concurrent)?\.(?:only|skip|todo|failing)\b|\b(?:fdescribe|fit|xdescribe|xit|xtest)(?:\.each)?\s*[(`]/;

// A focused test stops the rest of its file from running, and a skipped or
// failing one drops or inverts itself, the shared cases included, while Jest
// still exits green. This file holds only this check, so a focus here still
// runs it.
test.each(
  readdirSync(__dirname, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".ts"),
  ),
)("%s focuses and skips nothing", (file) => {
  expect(readFileSync(join(__dirname, file), "utf8")).not.toMatch(
    FOCUS_OR_SKIP,
  );
});
