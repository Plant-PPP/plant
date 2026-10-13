jest.mock("radix-ui", () =>
  jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal(),
);

import { renderToStaticMarkup } from "react-dom/server";

import { PriceDialog } from "./price-dialog";

const render = (overrides: boolean) =>
  renderToStaticMarkup(
    <PriceDialog
      instrument={{
        symbol: "AAPL",
        name: "Apple",
        currency: "ARS",
        type: "cedear",
      }}
      initial={{ price: "", date: "2026-10-12" }}
      today="2026-10-12"
      overrides={overrides}
      returnFocusTo={() => null}
      onClose={() => {}}
      onSubmit={() => true}
      onDelete={() => true}
    />,
  );

it("corrects a quoted instrument's price, and goes back to the quote", () => {
  const html = render(true);
  expect(html).toContain("Corregir precio");
  expect(html).toContain("Le gana a la cotización de ese día");
  expect(html).toContain("Volver a la cotización");
});

it("states the price of one the feeds do not price", () => {
  const html = render(false);
  expect(html).toContain("Cargar precio");
  expect(html).toContain("Lo usamos hasta que cargues otro.");
  expect(html).toContain("Borrar este precio");
});
