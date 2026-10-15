import { BellRing } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { Notice } from "./notice";

it("announces an error as an alert and the rest politely", () => {
  expect(renderToStaticMarkup(<Notice variant="error">x</Notice>)).toContain(
    'role="alert"',
  );
  for (const variant of ["info", "warning", "success"] as const) {
    expect(
      renderToStaticMarkup(<Notice variant={variant}>x</Notice>),
    ).toContain('role="status"');
  }
});

it("tints the box with its variant's token, never a loose color", () => {
  const html = renderToStaticMarkup(<Notice variant="warning">x</Notice>);
  expect(html).toContain("var(--warn)");
  expect(html).not.toMatch(/amber|emerald|red-\d/);
});

it("shows the title, the text and the action", () => {
  const html = renderToStaticMarkup(
    <Notice title="Tus alertas" icon={BellRing} action={<a href="/x">Ver</a>}>
      Dólar MEP subió
    </Notice>,
  );
  expect(html).toContain(">Tus alertas</p>");
  expect(html).toContain("Dólar MEP subió");
  expect(html).toContain('href="/x"');
  expect(html).toContain("lucide-bell-ring");
});
