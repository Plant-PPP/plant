import { renderToStaticMarkup } from "react-dom/server";
import { listView } from "@/test/list-view";
import { AccountsSetup } from "./accounts-setup";

const stub = async () => ({ ok: true as const, id: "x" });
const NAMED = { create: stub, rename: stub, archive: stub, restore: stub };
const ACCOUNTS = { create: stub, update: stub, archive: stub, restore: stub };

it("announces nothing while no write runs", () => {
  const html = renderToStaticMarkup(
    <AccountsSetup
      sourceConnections={listView()}
      portfolios={listView({ active: [{ id: "p1", name: "Principal" }] })}
      holders={{ view: listView(), actions: NAMED }}
      actions={{ sourceConnections: ACCOUNTS, portfolios: NAMED }}
    />,
  );
  expect(html).toContain('<p role="status" class="sr-only"></p>');
  expect(html).toContain('title="Principal">Principal</span>');
});

it("shows no holders anywhere for a page without them", () => {
  const html = renderToStaticMarkup(
    <AccountsSetup
      sourceConnections={listView({
        active: [
          {
            id: "c1",
            institution: "IOL",
            includeInTaxReport: true,
            holder: null,
            portfolio: { id: "p1", name: "Principal", archived: false },
          },
        ],
      })}
      portfolios={listView({ active: [{ id: "p1", name: "Principal" }] })}
      actions={{ sourceConnections: ACCOUNTS, portfolios: NAMED }}
    />,
  );
  expect(html).not.toMatch(/Titular/);
  expect(html).not.toContain(" · Vos");
  expect(html).toContain("Dónde tenés tus inversiones<");
});
