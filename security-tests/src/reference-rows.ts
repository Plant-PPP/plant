import type { Database } from "@plant/shared";

type Tables = Database["public"]["Tables"];

// Public tables with no user_id: market data every user reads and no user
// writes. A new one fails typecheck at REFERENCE_TARGETS in reference-table.ts
// until it has a target.
export type ReferenceTable = {
  [T in keyof Tables]: "user_id" extends keyof Tables[T]["Row"] ? never : T;
}[keyof Tables];

export type OwnedTable = Exclude<keyof Tables, ReferenceTable>;

// The reference tables the server writes daily; migrations seed the others.
export type QuoteTable = Extract<ReferenceTable, "fx_rates" | "prices">;

// The key another user would guess a row by. A new owned table fails typecheck
// here until it is listed.
export const OWNED_KEYS = {
  ai_costs: "id",
  consents: "id",
  holders: "id",
  holdings: "id",
  portfolios: "id",
  profiles: "user_id",
  source_connections: "id",
} as const satisfies {
  [T in OwnedTable]: "id" extends keyof Tables[T]["Row"] ? "id" : "user_id";
};

type Column<T extends ReferenceTable> = keyof Tables[T]["Row"] & string;

export type ReferenceRow<T extends ReferenceTable> = {
  key: [Column<T>, ...Column<T>[]];
  row: Tables[T]["Insert"];
};

export function filterOf({
  key,
  row,
}: {
  key: readonly string[];
  row: object;
}): string {
  const values = row as Record<string, unknown>;
  return key
    .map((column) => `${column}=eq.${String(values[column])}`)
    .join("&");
}

// Made-up quotes. No real symbol is PENTEST; on a local database that is not
// reset, the UVA row takes that day's slot and the real one is ignored.
export function referenceRows(date: string): {
  [T in QuoteTable]: ReferenceRow<T>;
} {
  const at = `${date}T12:00:00-03:00`;
  return {
    fx_rates: {
      key: ["kind", "rate_date"],
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
