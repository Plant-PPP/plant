import type { ReactNode } from "react";

import {
  addInstrument,
  searchInstruments,
} from "@/app/(app)/(data)/assets/instrument-actions";
import { InstrumentMarketProvider } from "@/components/holdings/instrument-market";
import { PrototypeRoot } from "@/components/prototype/prototype-root";
import { isProductionDeployment } from "@/lib/deployment";

// The pages over the user's holdings, debts and history, whose instrument
// pickers search the market through the instrument actions. Outside
// production they show made-up data held in the browser instead, and search
// only its catalog.
export default function DataLayout({ children }: { children: ReactNode }) {
  return isProductionDeployment() ? (
    <InstrumentMarketProvider
      market={{ search: searchInstruments, add: addInstrument }}
    >
      {children}
    </InstrumentMarketProvider>
  ) : (
    <PrototypeRoot>{children}</PrototypeRoot>
  );
}
