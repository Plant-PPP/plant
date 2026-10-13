import { quotesNeeded, readSnapshot } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { ReactNode } from "react";

import { PrototypeProvider } from "@/components/prototype/prototype-provider";
import { buildFixtures } from "@/lib/prototype/fixtures";
import { createFixtureQuoteReader } from "@/lib/prototype/quote-reader";

// Every data page over made-up data held in the browser, for `next dev` and
// previews: the `(data)` layout renders it only outside production.
export async function PrototypeRoot({ children }: { children: ReactNode }) {
  const today = buenosAiresDate(new Date());
  const fixtures = buildFixtures(today);
  const need = quotesNeeded(fixtures.holdings.map((row) => row.holding));
  const { snapshot } = await readSnapshot(
    createFixtureQuoteReader(fixtures.quotes),
    today,
    {
      ...need,
      // Every UVA debt is owed at the UVA of the day.
      fxKinds: [...need.fxKinds, "uva"],
      symbols: [
        ...need.symbols,
        ...fixtures.instruments.map(({ symbol }) => symbol),
      ],
    },
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p
        role="note"
        className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
      >
        Datos de prueba. Lo que cambies se pierde al recargar.
      </p>
      <PrototypeProvider today={today} snapshot={snapshot}>
        {children}
      </PrototypeProvider>
    </div>
  );
}
