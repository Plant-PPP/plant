import { normalizeSymbol } from "@plant/core";

import type { ImportRow } from "./review";

// The user's account a document's account label names: the one whose
// institution reads the same, or contains it, once case, accents and
// punctuation are set aside; none when no account or several do.
export function accountFor(
  label: string,
  accounts: readonly { id: string; institution: string }[],
): string | undefined {
  const key = normalizeSymbol(label);
  if (key === "") return undefined;
  const same = accounts.filter(
    (each) => normalizeSymbol(each.institution) === key,
  );
  if (same.length === 1) return same[0]!.id;
  const near = accounts.filter((each) => {
    const institution = normalizeSymbol(each.institution);
    return institution.includes(key) || key.includes(institution);
  });
  return near.length === 1 ? near[0]!.id : undefined;
}

// Each row a document lists under an account routed to the user's account
// it names; a row whose label names none is left for the user to choose.
export const routeRows = (
  rows: readonly ImportRow[],
  accounts: readonly { id: string; institution: string }[],
): ImportRow[] =>
  rows.map((row) => {
    if (row.accountLabel === undefined) return row;
    const accountId = accountFor(row.accountLabel, accounts);
    return accountId ? { ...row, accountId } : row;
  });
