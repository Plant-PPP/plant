import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

export type AccountLink = "portfolio" | "holder";

// Whether an account defaults to the portfolio, or belongs to the holder, with
// this id.
export function embeds(
  row: SourceConnectionRow,
  key: AccountLink,
  id: string,
): boolean {
  return row[key]?.id === id;
}

// The names of the active accounts that default to a portfolio or belong to
// a holder.
export function accountsUsing(
  active: SourceConnectionRow[],
  key: AccountLink,
  id: string,
): string[] {
  return active
    .filter((row) => embeds(row, key, id))
    .map((row) => row.institution);
}
