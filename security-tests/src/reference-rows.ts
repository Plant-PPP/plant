import type { Database } from "@plant/shared";

type Tables = Database["public"]["Tables"];

// Public tables with no user_id: market data every user reads and only the
// server writes. A new one fails typecheck below until it has a row.
export type ReferenceTable = {
  [T in keyof Tables]: "user_id" extends keyof Tables[T]["Row"] ? never : T;
}[keyof Tables];

type ReferenceRow<T extends ReferenceTable> = {
  key: (keyof Tables[T]["Row"] & string)[];
  filter: string;
  row: Tables[T]["Insert"];
};

// Made-up quotes. No real symbol is PENTEST; the UVA row can stand in for
// that day's real one on a local database that is not reset.
export function referenceRows(date: string): {
  [T in ReferenceTable]: ReferenceRow<T>;
} {
  const at = `${date}T12:00:00-03:00`;
  return {
    fx_rates: {
      key: ["kind", "rate_date"],
      filter: `kind=eq.uva&rate_date=eq.${date}`,
      row: {
        kind: "uva",
        rate_date: date,
        buy: null,
        sell: 1650.5,
        source: "argentinadatos",
        quoted_at: at,
        fetched_at: at,
      },
    },
    prices: {
      key: ["symbol", "price_date"],
      filter: `symbol=eq.PENTEST&price_date=eq.${date}`,
      row: {
        symbol: "PENTEST",
        price_date: date,
        price: 1,
        currency: "USD",
        source: "kraken",
        quoted_at: at,
        fetched_at: at,
      },
    },
  };
}
