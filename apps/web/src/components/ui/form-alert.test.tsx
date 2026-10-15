import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FormAlert } from "./form-alert";

it("keeps the text beside the field for screen readers, out of view", () => {
  const html = renderToStaticMarkup(
    <FormAlert id="a">No pudimos entrar.</FormAlert>,
  );
  expect(html).toBe(
    '<p class="sr-only" id="a" data-slot="form-alert">No pudimos entrar.</p>',
  );
});

it("takes no role: the toast announces it", () => {
  expect(renderToStaticMarkup(<FormAlert>x</FormAlert>)).not.toContain("role=");
});

it("leaves role=alert to Notice, so errors go through one of them", () => {
  const src = join(__dirname, "../..");
  const files = readdirSync(src, { recursive: true, encoding: "utf8" });
  const owner = join("components", "ui", "notice.tsx");
  const hits = files.filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !/\.test\.tsx?$/.test(file) &&
      file !== owner &&
      /role(?:=|:\s*)\{?\s*["'`]alert["'`]/.test(
        readFileSync(join(src, file), "utf8"),
      ),
  );
  expect(hits).toEqual([]);
});
