"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import type { AssetsParam } from "@/lib/holdings/assets-filter";
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
// way round) keeps both.
export function useAssetsUrl(params: KeysetParams): AssetsUrl {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, apply] = useOptimistic(
    params,
    (current, [key, value]: [AssetsParam, string | null]) =>
      withParam(current, key, value),
  );
  const set = (key: AssetsParam, value: string | null) =>
    startTransition(() => {
      apply([key, value]);
      router.replace(paramHref(shown, key, value), { scroll: false });
    });
  return { params: shown, set, pending };
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
