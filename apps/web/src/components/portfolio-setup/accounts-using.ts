import { accountLabel } from "@/lib/portfolio-setup/messages";
import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

export function sourceConnectionLabel(row: SourceConnectionRow): string {
  return accountLabel(row.institution, row.holder?.name ?? null);
}

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

// The labels of the active accounts that default to a portfolio or belong to
// a holder.
export function accountsUsing(
  active: SourceConnectionRow[],
  key: AccountLink,
  id: string,
): string[] {
  return active
    .filter((row) => embeds(row, key, id))
    .map(sourceConnectionLabel);
}
