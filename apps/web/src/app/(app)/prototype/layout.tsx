import { quotesNeeded, readSnapshot } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PrototypeProvider } from "@/components/prototype/prototype-provider";
import { isProductionDeployment } from "@/lib/deployment";
import { buildFixtures } from "@/lib/prototype/fixtures";
import { createFixtureQuoteReader } from "@/lib/prototype/quote-reader";

export const dynamic = "force-dynamic";

// The prototype: the real screens over made-up data held in the browser.
// Served by `next dev` and previews, never by production.
export default async function PrototypeLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (isProductionDeployment()) notFound();
  const today = buenosAiresDate(new Date());
  const fixtures = buildFixtures(today);
  const need = quotesNeeded(fixtures.holdings.map((row) => row.holding));
  const { snapshot } = await readSnapshot(
    createFixtureQuoteReader(fixtures.quotes),
    today,
    {
      ...need,
      symbols: [
        ...need.symbols,
        ...fixtures.instruments.map(({ symbol }) => symbol),
      ],
    },
  );
  return (
    <div className="grid gap-4">
      <p
        role="note"
        className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
      >
        Prototipo con datos de prueba. Lo que cambies se pierde al recargar.
      </p>
      <PrototypeProvider today={today} snapshot={snapshot}>
        {children}
      </PrototypeProvider>
    </div>
  );
}
