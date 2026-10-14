import { renderToStaticMarkup } from "react-dom/server";

import { nextOption, Segmented } from "./segmented";

const ORDER = ["2026", "2025", "2024"] as const;

it("moves with the arrows, wrapping, and to the ends with Home and End", () => {
  expect(nextOption(ORDER, "2026", "ArrowRight")).toBe("2025");
  expect(nextOption(ORDER, "2024", "ArrowRight")).toBe("2026");
  expect(nextOption(ORDER, "2026", "ArrowLeft")).toBe("2024");
  expect(nextOption(ORDER, "2025", "Home")).toBe("2026");
  expect(nextOption(ORDER, "2025", "End")).toBe("2024");
  expect(nextOption(ORDER, "2025", "Enter")).toBeNull();
});

it("is a tablist where only the chosen tab takes focus", () => {
  const html = renderToStaticMarkup(
    <Segmented
      label="Años"
      options={ORDER.map((value) => ({ value, label: value }))}
      value="2025"
      onChange={() => {}}
      controls="panel"
    />,
  );
  expect(html).toContain('role="tablist" aria-label="Años"');
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"/);
  expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  expect(html.match(/aria-controls="panel"/g)).toHaveLength(3);
});
