import { renderToStaticMarkup } from "react-dom/server";

import { PreferencesCard } from "./preferences-card";

const render = (preferredUnit: "ars" | null) =>
  renderToStaticMarkup(
    <PreferencesCard
      preferences={{ referenceDollar: "mep", preferredUnit }}
      onChange={async () => ({ ok: true })}
    />,
  );

it("labels both selects and shows the reference dollar", () => {
  const html = render(null);
  expect(html).toMatch(
    /<label[^>]*for="[^"]*-dollar"[^>]*>Dólar de referencia</,
  );
  expect(html).toMatch(
    /<label[^>]*for="[^"]*-unit"[^>]*>Las pantallas abren en</,
  );
  expect(html).toContain("Tu dólar de referencia (Dólar MEP)");
});

it("shows the unit the user picked", () => {
  const html = render("ars");
  expect(html).toContain(">Pesos<");
  expect(html).not.toContain("Tu dólar de referencia (Dólar MEP)");
});
