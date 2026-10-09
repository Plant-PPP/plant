import { renderToStaticMarkup } from "react-dom/server";
import { StatusNotice } from "./status-notice";

it("shows its text as a status", () => {
  const html = renderToStaticMarkup(
    <StatusNotice>Archivaste Trading.</StatusNotice>,
  );
  expect(html).toBe(
    '<p data-slot="status-notice" role="status" class="text-sm text-muted-foreground">Archivaste Trading.</p>',
  );
});

it("stays mounted and hidden while it has nothing to say", () => {
  const html = renderToStaticMarkup(<StatusNotice>{undefined}</StatusNotice>);
  expect(html).toBe(
    '<p data-slot="status-notice" role="status" class="sr-only"></p>',
  );
});
