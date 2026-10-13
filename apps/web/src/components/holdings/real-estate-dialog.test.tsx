jest.mock("radix-ui", () =>
  jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal(),
);

import { renderToStaticMarkup } from "react-dom/server";

import { RealEstateDialog } from "./real-estate-dialog";
import { sheetFields } from "./real-estate-fields";

const render = (payment: "cash" | "mortgage") =>
  renderToStaticMarkup(
    <RealEstateDialog
      name="Departamento Palermo"
      initial={{
        ...sheetFields(undefined, { currency: "USD", today: "2026-10-12" }),
        rent: "650000",
        payment,
        liabilityId: payment === "cash" ? "" : "d1",
      }}
      liabilities={[{ id: "d1", label: "Hipoteca del departamento" }]}
      unit="ars"
      figures={() => ({
        netMonthly: "61400",
        rentalYield: "0.066947",
        appreciation: { amount: "13000000", share: "0.158537" },
      })}
      returnFocusTo={() => null}
      onClose={() => {}}
      onSubmit={() => true}
    />,
  );

it("shows the figures the fields make, in the page's unit", () => {
  const html = render("mortgage");
  expect(html).toContain("Ficha del inmueble");
  expect(html).toContain("Departamento Palermo");
  expect(html).toContain("$ 61.400,00");
  expect(html).toContain("6,7 %");
  expect(html).toContain("$ 13.000.000,00 (15,9 %)");
});

it("asks for the debt only when the property is financed", () => {
  expect(render("mortgage")).toContain("Hipoteca del departamento");
  expect(render("cash")).not.toContain(">Deuda<");
});
