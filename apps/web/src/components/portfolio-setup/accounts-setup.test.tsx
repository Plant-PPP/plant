import { renderToStaticMarkup } from "react-dom/server";
import { listView } from "@/test/list-view";
import { AccountsSetup } from "./accounts-setup";

const stub = async () => ({ ok: true as const, id: "x" });
const PORTFOLIOS = { create: stub, rename: stub, archive: stub, restore: stub };
const ACCOUNTS = { create: stub, update: stub, archive: stub, restore: stub };

it("announces nothing while no write runs", () => {
  const html = renderToStaticMarkup(
    <AccountsSetup
      sourceConnections={listView()}
      portfolios={listView({ active: [{ id: "p1", name: "Principal" }] })}
      actions={{ sourceConnections: ACCOUNTS, portfolios: PORTFOLIOS }}
    />,
  );
  expect(html).toContain('<p role="status" class="sr-only"></p>');
  expect(html).toContain('title="Principal">Principal</span>');
});

it("shows accounts by institution, with their portfolio and report", () => {
  const html = renderToStaticMarkup(
    <AccountsSetup
      sourceConnections={listView({
        active: [
          {
            id: "c1",
            institution: "IOL",
            includeInTaxReport: true,
            portfolio: { id: "p1", name: "Principal", archived: false },
          },
        ],
      })}
      portfolios={listView({ active: [{ id: "p1", name: "Principal" }] })}
      actions={{ sourceConnections: ACCOUNTS, portfolios: PORTFOLIOS }}
    />,
  );
  expect(html).toContain('title="IOL">IOL</span>');
  expect(html).toContain("Principal · Incluida en el reporte");
  expect(html).toContain("Dónde tenés tus inversiones<");
});
