import { renderToStaticMarkup } from "react-dom/server";

import { DeleteAccountCard } from "./delete-account-card";
import { ExportCard } from "./export-card";

it("offers each export file by its name, without building it", () => {
  const csv = jest.fn(() => "a");
  const html = renderToStaticMarkup(
    <ExportCard
      files={[
        { name: "tenencias.csv", label: "Tenencias", csv },
        { name: "deudas.csv", label: "Deudas", csv },
      ]}
    />,
  );
  expect(html).toContain("Tenencias</button>");
  expect(html).toContain("Deudas</button>");
  expect(csv).not.toHaveBeenCalled();
});

it("asks before deleting the account", () => {
  const onDelete = jest.fn();
  const html = renderToStaticMarkup(<DeleteAccountCard onDelete={onDelete} />);
  expect(html).toContain("Borrar mi cuenta</button>");
  expect(html).not.toContain("¿Borrar tu cuenta?");
  expect(onDelete).not.toHaveBeenCalled();
});
