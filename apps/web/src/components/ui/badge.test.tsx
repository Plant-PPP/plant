import { renderToStaticMarkup } from "react-dom/server";

import { Badge } from "./badge";

it("keeps the text in the foreground on a tinted variant", () => {
  const html = renderToStaticMarkup(
    <Badge variant="warning">Recalculado</Badge>,
  );
  expect(html).toContain("bg-warn/15 text-foreground");
  expect(html).toContain('data-variant="warning"');
});

it("is neutral by default", () => {
  expect(renderToStaticMarkup(<Badge>Parcial</Badge>)).toContain(
    "bg-secondary text-secondary-foreground",
  );
});
