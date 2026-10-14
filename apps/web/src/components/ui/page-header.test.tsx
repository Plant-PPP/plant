import { renderToStaticMarkup } from "react-dom/server";

import { PageHeader } from "./page-header";

it("names the page for screen readers and keeps its actions off paper", () => {
  const html = renderToStaticMarkup(
    <PageHeader
      title="Resumen"
      filters={<button type="button">Cartera</button>}
      actions={<button type="button">PDF</button>}
    />,
  );
  expect(html).toContain('<h1 class="sr-only">Resumen</h1>');
  expect(html).toMatch(/>Cartera<\/button>.*data-print="hidden".*>PDF</);
});
