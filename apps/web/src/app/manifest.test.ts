import { readFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "./manifest";

it("uses the light --sidebar color as the app background", () => {
  const css = readFileSync(join(__dirname, "globals.css"), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
  const sidebar = root.match(/--sidebar:\s*(#[0-9a-f]{6});/i)?.[1];
  const { background_color, theme_color } = manifest();
  expect(sidebar).toBeDefined();
  expect(background_color).toBe(sidebar);
  expect(theme_color).toBe(sidebar);
});
