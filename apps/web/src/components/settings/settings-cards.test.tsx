import { renderToStaticMarkup } from "react-dom/server";

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
