"use client";

import type { KeyboardEvent } from "react";

import {
  type AssetsTab,
  type AssetsTabs as Tabs,
  DEFAULT_TAB,
  tabOf,
} from "@/lib/holdings/assets-filter";
import { cn } from "@/lib/utils";

import type { AssetsUrl } from "./assets-url";

const orderOf = (tabs: Tabs) => Object.keys(tabs) as AssetsTab[];

export const tabId = (base: string, tab: AssetsTab) => `${base}-tab-${tab}`;
export const panelId = (base: string) => `${base}-panel`;

// The tab a key moves to from `current`: the arrows wrap around, Home and End
// go to the ends, and any other key moves nowhere.
export function nextTab(
  current: AssetsTab,
  key: string,
  tabs: Tabs,
): AssetsTab | null {
  const order = orderOf(tabs);
  const at = order.indexOf(current);
  switch (key) {
    case "ArrowRight":
      return order[(at + 1) % order.length] ?? null;
    case "ArrowLeft":
      return order[(at - 1 + order.length) % order.length] ?? null;
    case "Home":
      return order[0] ?? null;
    case "End":
      return order.at(-1) ?? null;
    default:
      return null;
  }
}

// The page's tabs, each with how many rows its table shows, kept in the URL.
// Arrow keys move between them; they wait while a write runs, as the filters
// do. The table below is their panel (`panelId`).
export function AssetsTabs({
  url,
  tabs,
  idBase,
  counts,
  pending,
}: {
  url: AssetsUrl;
  tabs: Tabs;
  idBase: string;
  counts: Partial<Record<AssetsTab, number>>;
  pending: boolean;
}) {
  const shown = tabOf(url.params.tab, tabs);
  const choose = (next: AssetsTab) => {
    if (pending || next === shown) return;
    url.set("tab", next === DEFAULT_TAB ? null : next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTab(shown, event.key, tabs);
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
      className="bg-muted inline-flex h-7 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-md p-0.5"
    >
      {orderOf(tabs).map((each) => (
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
            "focus-visible:ring-ring h-full rounded-sm px-2.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed",
            each === shown
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tabs[each]}
          {counts[each] !== undefined && (
            <>
              {" "}
              <span className="text-muted-foreground tabular-nums">
                {counts[each]}
              </span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
