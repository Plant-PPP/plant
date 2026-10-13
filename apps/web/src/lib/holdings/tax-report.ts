import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

// Whether an account's holdings can count in the report: an asset counts only
// when its account and the asset itself are both included. An account the
// page does not list counts as included.
export const accountInTaxReport = (
  accounts: readonly Pick<SourceConnectionRow, "id" | "includeInTaxReport">[],
  accountId: string,
): boolean =>
  accounts.find((each) => each.id === accountId)?.includeInTaxReport ?? true;
