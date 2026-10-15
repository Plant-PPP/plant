"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

// One step of the header's breadcrumb; the last is the page itself.
export type Crumb = { label: string; href?: string };

const CrumbsContext = createContext<{
  crumbs: readonly Crumb[] | null;
  setCrumbs: (crumbs: readonly Crumb[] | null) => void;
}>({ crumbs: null, setCrumbs: () => {} });

// Holds the breadcrumb a detail page names itself with, for the header.
export function PageCrumbsProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<readonly Crumb[] | null>(null);
  return (
    <CrumbsContext value={{ crumbs, setCrumbs }}>{children}</CrumbsContext>
  );
}

export const usePageCrumbs = () => useContext(CrumbsContext).crumbs;

// A detail page's breadcrumb (`Activos › Bitcoin`): its parent links back, so
// the page needs no back link of its own. The header falls back to the
// section's name on pages that set none.
export function PageCrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const { setCrumbs } = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(JSON.parse(key) as Crumb[]);
    return () => setCrumbs(null);
  }, [key, setCrumbs]);
  return null;
}
