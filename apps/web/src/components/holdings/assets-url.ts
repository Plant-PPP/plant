"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import {
  type AssetsParam,
  type AssetsTabs,
  tabOf,
} from "@/lib/holdings/assets-filter";
import { type KeysetParams, paramHref } from "@/lib/supabase/keyset";

export type AssetsUrl = {
  // The params as the user last chose them, ahead of the page that loads them.
  params: KeysetParams;
  set: (key: AssetsParam, value: string | null) => void;
  // Whether the page for a change is still loading: a link the server built
  // still carries the params before it.
  pending: boolean;
};

// The assets page's URL, owned in one place: each change applies to the params
// the user already chose, so a tab picked while a filter loads (or the other
// way round) keeps both. A change `inPlace` says the page answers from what
// it already has only rewrites the URL, with no request to the server.
export function useAssetsUrl(
  params: KeysetParams,
  inPlace?: (next: KeysetParams) => boolean,
): AssetsUrl {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The params changed in place, over the ones the server rendered; a new
  // render (a write's, or a change that needs the server) starts from its own.
  const [local, setLocal] = useState<{
    over: KeysetParams;
    params: KeysetParams;
  } | null>(null);
  const current = local?.over === params ? local.params : params;
  const [shown, apply] = useOptimistic(
    current,
    (base, [key, value]: [AssetsParam, string | null]) =>
      withParam(base, key, value),
  );
  const set = (key: AssetsParam, value: string | null) => {
    const href = paramHref(shown, key, value);
    if (inPlace?.(withParam(shown, key, value))) {
      setLocal({ over: params, params: withParam(shown, key, value) });
      // Next's router takes the new URL as its own, so a later refresh
      // renders it.
      window.history.replaceState(null, "", href);
      return;
    }
    startTransition(() => {
      apply([key, value]);
      router.replace(href, { scroll: false });
    });
  };
  return { params: shown, set, pending };
}

// The params a filter, search or tab change can apply over: the server sent
// every holding and today's quotes, so only the unit, the sales year and the
// sales of a filter it did not render need it.
const FILTER_PARAMS = ["portfolio", "class", "search"] as const;
export function answeredInPlace(
  rendered: KeysetParams,
  next: KeysetParams,
  tabs: AssetsTabs,
): boolean {
  const differs = (key: AssetsParam) =>
    String(rendered[key] ?? "") !== String(next[key] ?? "");
  if (differs("unit") || differs("year")) return false;
  return tabOf(next.tab, tabs) !== "sales" || !FILTER_PARAMS.some(differs);
}

export function withParam(
  params: KeysetParams,
  key: AssetsParam,
  value: string | null,
): KeysetParams {
  const next = { ...params };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

// What a typed search becomes once in the URL: an unpaired surrogate reads
// back as U+FFFD, so the box and the URL compare equal.
export const searchParamValue = (typed: string): string =>
  new URLSearchParams({ q: typed.trim() }).get("q") ?? "";
