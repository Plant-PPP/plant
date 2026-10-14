import { Upload } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState } from "./empty-state";

it("says what goes here and offers the way to start", () => {
  const html = renderToStaticMarkup(
    <EmptyState
      icon={Upload}
      title="Tu patrimonio, en un lugar"
      actions={<a href="/import">Cargar</a>}
    >
      Subí el resumen de tu broker.
    </EmptyState>,
  );
  expect(html).toContain(">Tu patrimonio, en un lugar</p>");
  expect(html).toContain("Subí el resumen de tu broker.");
  expect(html).toContain('href="/import"');
  expect(html).toContain('aria-hidden="true"');
});
