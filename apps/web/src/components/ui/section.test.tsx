import { renderToStaticMarkup } from "react-dom/server";

import { Section } from "./section";

it("names the section by its heading, with its description and actions", () => {
  const html = renderToStaticMarkup(
    <Section
      title="Cierres"
      description="Cada mes se cierra solo"
      actions={<button type="button">2026</button>}
    >
      <p>tabla</p>
    </Section>,
  );
  const id = /<h2 id="([^"]+)"/.exec(html)?.[1];
  expect(id).toBeDefined();
  expect(html).toContain(`aria-labelledby="${id}"`);
  expect(html).toContain("text-sm font-semibold");
  expect(html).toContain("Cada mes se cierra solo");
  expect(html).toContain(">2026</button>");
  expect(html).not.toMatch(/rounded-(lg|xl) border/);
});
