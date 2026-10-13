// The pages an instrument, account or portfolio opens: the path its symbol
// or id is appended to. One left out is named plainly.
export type ScopeHrefs = Partial<
  Record<"instrument" | "account" | "portfolio", string>
>;

// The page each of a kind opens, if the page links that kind.
export function scopeLink(
  hrefs: ScopeHrefs | undefined,
  kind: keyof ScopeHrefs,
): ((id: string) => string) | undefined {
  const base = hrefs?.[kind];
  return base === undefined
    ? undefined
    : (id) => `${base}${encodeURIComponent(id)}`;
}

// Where every scope's name links to on the app's pages.
export const SCOPE_HREFS: Required<ScopeHrefs> = {
  instrument: "/assets/",
  account: "/accounts/",
  portfolio: "/portfolios/",
};
