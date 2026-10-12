import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

export function accountsUsing(
  active: SourceConnectionRow[],
  id: string,
): string[] {
  return active
    .filter((row) => row.portfolio.id === id)
    .map((row) => row.institution);
}
