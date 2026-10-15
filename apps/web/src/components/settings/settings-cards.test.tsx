import { renderToStaticMarkup } from "react-dom/server";

import { AlertsCard } from "./alerts-card";
import { DeleteAccountCard } from "./delete-account-card";
import { ExportCard } from "./export-card";

it("offers the Excel and each CSV by its name, without reading the data", () => {
  const load = jest.fn(async () => ({ tables: [], truncated: false }));
  const html = renderToStaticMarkup(<ExportCard load={load} />);
  expect(html).toContain("Todo en Excel</button>");
  expect(html).toContain("Tenencias</button>");
  expect(html).toContain("Deudas</button>");
  expect(load).not.toHaveBeenCalled();
});

it("asks before deleting the account", () => {
  const onDelete = jest.fn();
  const html = renderToStaticMarkup(<DeleteAccountCard onDelete={onDelete} />);
  expect(html).toContain("Borrar mi cuenta</button>");
  expect(html).not.toContain("¿Borrar tu cuenta?");
  expect(onDelete).not.toHaveBeenCalled();
});

it("says the alerts could not be read, not that there are none", () => {
  const html = renderToStaticMarkup(
    <AlertsCard
      alerts={[]}
      readFailed
      onCreate={async () => "ok"}
      onDelete={async () => true}
    />,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("No pudimos leer tus alertas");
});
