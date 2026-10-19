import { renderToStaticMarkup } from "react-dom/server";

import type { LastSync } from "@/lib/connections/api-key";

import { SyncStatus } from "./api-key-card";

const sync = (change: Partial<LastSync>): string =>
  renderToStaticMarkup(
    <SyncStatus
      provider="Bitso"
      sync={{
        importId: "import-1",
        status: "ready",
        failure: null,
        on: "2026-10-14",
        at: "12:31",
        ...change,
      }}
    />,
  );

it("links a sync read and waiting to its review, in the gain color", () => {
  const html = sync({ status: "ready" });
  expect(html).toContain("Última sincronización: 14/10/2026 a las 12:31.");
  expect(html).toContain('href="/import/import-1"');
  expect(html).toContain("text-gain");
});

it("shows a confirmed sync without a link to review it", () => {
  const html = sync({ status: "confirmed" });
  expect(html).toContain("Última sincronización: 14/10/2026 a las 12:31.");
  expect(html).not.toContain('href="/import');
});

it.each(["queued", "reading"] as const)(
  "shows a %s sync as running, in the warn color",
  (status) => {
    const html = sync({ status });
    expect(html).toContain("Sincronizando desde el 14/10/2026 a las 12:31.");
    expect(html).toContain("text-warn");
  },
);

it("says why a sync failed, in the sync's own words", () => {
  const html = sync({ status: "failed", failure: "connection_rejected" });
  expect(html).toContain(
    "La última sincronización falló (14/10/2026 a las 12:31)",
  );
  expect(html).toContain("Bitso rechazó la conexión.");
  expect(html).toContain("text-destructive");
});

it("says a sync with no failure was replaced by another", () => {
  const html = sync({ status: "failed", failure: null });
  expect(html).toContain("La reemplazaste por otra sincronización.");
  expect(html).not.toContain("No pudimos leer la cuenta conectada");
});
