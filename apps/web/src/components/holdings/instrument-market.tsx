"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type {
  AddResult,
  SearchResult,
} from "@/app/(app)/(data)/assets/instrument-actions";
import type { InstrumentRow } from "@/lib/holdings/read";

// The server actions an instrument picker searches the market and adds a
// listing with; absent, pickers search the catalog only.
export type InstrumentMarket = {
  search: (query: string) => Promise<SearchResult>;
  add: (symbol: string, market: string) => Promise<AddResult>;
};

const InstrumentMarketContext = createContext<InstrumentMarket | null>(null);

export function InstrumentMarketProvider({
  market,
  children,
}: {
  market: InstrumentMarket;
  children: ReactNode;
}) {
  return (
    <InstrumentMarketContext.Provider value={market}>
      {children}
    </InstrumentMarketContext.Provider>
  );
}

export const useInstrumentMarket = () => useContext(InstrumentMarketContext);

// The page's catalog plus what its pickers added from the market since it
// loaded, in symbol order.
export function useCatalog(
  given: readonly InstrumentRow[],
): [InstrumentRow[], (added: InstrumentRow) => void] {
  const [added, setAdded] = useState<InstrumentRow[]>([]);
  const catalog = useMemo(() => {
    const symbols = new Set(given.map(({ symbol }) => symbol));
    return [
      ...given,
      ...added.filter(({ symbol }) => !symbols.has(symbol)),
    ].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [given, added]);
  const add = useCallback(
    (row: InstrumentRow) =>
      setAdded((rows) =>
        rows.some(({ symbol }) => symbol === row.symbol)
          ? rows
          : [...rows, row],
      ),
    [],
  );
  return [catalog, add];
}
