import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormAlert } from "./form-alert";

it("is announced as an alert in the error color", () => {
  const html = renderToStaticMarkup(<FormAlert>No pudimos entrar.</FormAlert>);
  expect(html).toBe(
    '<p data-slot="form-alert" class="text-sm text-destructive" role="alert">No pudimos entrar.</p>',
  );
});

it("lets a dense spot replace the text size", () => {
  const html = renderToStaticMarkup(
    <FormAlert className="px-2 py-1.5 text-xs">x</FormAlert>,
  );
  expect(html).toContain('class="text-destructive px-2 py-1.5 text-xs"');
});

it("stays an alert whatever role the caller passes", () => {
  const props = { role: "status" } as React.ComponentProps<typeof FormAlert>;
  const html = renderToStaticMarkup(<FormAlert {...props}>x</FormAlert>);
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('role="status"');
});

it("is the only alert written by hand", () => {
  const src = join(__dirname, "../..");
  const files = readdirSync(src, { recursive: true, encoding: "utf8" });
  const hits = files.filter(
    (file) =>
      file.endsWith(".tsx") &&
      !file.endsWith(".test.tsx") &&
      !file.endsWith("form-alert.tsx") &&
      readFileSync(join(src, file), "utf8").includes('role="alert"'),
  );
  expect(hits).toEqual([]);
});
