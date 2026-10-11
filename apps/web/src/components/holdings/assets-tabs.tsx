"use client";

import type { KeyboardEvent } from "react";

import {
  type AssetsTab,
  DEFAULT_TAB,
  TABS,
  tabOf,
} from "@/lib/holdings/assets-filter";
import { cn } from "@/lib/utils";

import type { AssetsUrl } from "./assets-url";

const ORDER = Object.keys(TABS) as AssetsTab[];

export const tabId = (base: string, tab: AssetsTab) => `${base}-tab-${tab}`;
export const panelId = (base: string) => `${base}-panel`;

// The tab a key moves to from `current`: the arrows wrap around, Home and End
// go to the ends, and any other key moves nowhere.
export function nextTab(current: AssetsTab, key: string): AssetsTab | null {
  const at = ORDER.indexOf(current);
  switch (key) {
    case "ArrowRight":
      return ORDER[(at + 1) % ORDER.length] ?? null;
    case "ArrowLeft":
      return ORDER[(at - 1 + ORDER.length) % ORDER.length] ?? null;
    case "Home":
      return ORDER[0] ?? null;
    case "End":
      return ORDER.at(-1) ?? null;
    default:
      return null;
  }
}

// The page's tabs, each with how many rows its table shows, kept in the URL.
// Arrow keys move between them; they wait while a write runs, as the filters
// do. The table below is their panel (`panelId`).
export function AssetsTabs({
  url,
  idBase,
  counts,
  pending,
}: {
  url: AssetsUrl;
  idBase: string;
  counts: Record<AssetsTab, number>;
  pending: boolean;
}) {
  const shown = tabOf(url.params.vista);
  const choose = (next: AssetsTab) => {
    if (pending || next === shown) return;
    url.set("vista", next === DEFAULT_TAB ? null : next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTab(shown, event.key);
    if (!next) return;
    event.preventDefault();
    if (pending) return;
    choose(next);
    document.getElementById(tabId(idBase, next))?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Vista"
      className="bg-muted inline-flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg p-0.5"
    >
      {ORDER.map((each) => (
        <button
          key={each}
          id={tabId(idBase, each)}
          type="button"
          role="tab"
          aria-selected={each === shown}
          aria-controls={panelId(idBase)}
          aria-disabled={pending || undefined}
          tabIndex={each === shown ? 0 : -1}
          onClick={() => choose(each)}
          onKeyDown={onKeyDown}
          className={cn(
            "focus-visible:ring-ring rounded-md px-3 py-1 text-sm whitespace-nowrap outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed",
            each === shown
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {TABS[each]}{" "}
          <span className="text-muted-foreground tabular-nums">
            {counts[each]}
          </span>
        </button>
      ))}
    </div>
  );
}
