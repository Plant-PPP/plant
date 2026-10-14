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

// The key another user would guess a row by: its id, its id paired with its
// owner where the primary key is (user_id, id), or its owner. A new owned
// table fails typecheck here until it is listed.
export const OWNED_KEYS = {
  account_api_keys: "id",
  ai_conversations: "user_id,id",
  ai_costs: "id",
  ai_messages: "user_id,id",
  ai_questions: "user_id,id",
  column_mappings: "id",
  consents: "id",
  holdings: "id",
  import_debts: "id",
  import_items: "id",
  import_operations: "id",
  imports: "id",
  liabilities: "id",
  manual_prices: "id",
  manual_rates: "id",
  movements: "id",
  operations: "id",
  pinned_charts: "id",
  portfolios: "id",
  price_alerts: "id",
  profiles: "user_id",
  source_connections: "id",
  tax_report_exclusions: "id",
  uploaded_documents: "id",
} as const satisfies {
  [T in OwnedTable]: "id" extends keyof Tables[T]["Row"]
    ? "id" | "user_id,id"
    : "user_id";
};

// The owned tables authenticated may DELETE from, each table's isolation test
// in supabase/tests pins the grant.
export const DELETE_GRANTED: ReadonlySet<OwnedTable> = new Set<OwnedTable>([
  "account_api_keys",
  "ai_conversations",
  "holdings",
  "liabilities",
  "manual_prices",
  "manual_rates",
  "movements",
  "operations",
  "pinned_charts",
  "portfolios",
  "price_alerts",
  "source_connections",
  "tax_report_exclusions",
  "uploaded_documents",
]);

// The owned tables authenticated reads only some columns of, with those
// columns: a GET of `*` is refused, so every shared case names them. Each
// table's isolation test in supabase/tests pins the grant.
const READABLE_COLUMNS: Partial<Record<OwnedTable, string>> = {
  account_api_keys:
    "id,user_id,source_connection_id,provider,key_hint,created_at",
};

// The `select=` a GET of the table's rows sends, with its trailing `&`, or
// nothing where authenticated reads every column.
export const selectOf = (table: OwnedTable): string => {
  const columns = READABLE_COLUMNS[table];
  return columns ? `select=${columns}&` : "";
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
