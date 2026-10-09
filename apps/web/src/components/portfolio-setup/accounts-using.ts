import { accountLabel } from "@/lib/portfolio-setup/messages";
import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

export function sourceConnectionLabel(row: SourceConnectionRow): string {
  return accountLabel(row.institution, row.holder?.name ?? null);
}

// The labels of the active accounts that default to a portfolio or belong to
// a holder.
export function accountsUsing(
  active: SourceConnectionRow[],
  key: "portfolio" | "holder",
  id: string,
): string[] {
  return active.filter((row) => row[key]?.id === id).map(sourceConnectionLabel);
}
