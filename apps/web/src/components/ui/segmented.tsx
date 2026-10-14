"use client";

import type { KeyboardEvent } from "react";
import { useId } from "react";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  // Shown muted after the label, as a tab's row count.
  count?: number;
};

// The option a key moves to from `current`: the arrows wrap around, Home and
// End go to the ends, and any other key moves nowhere.
export function nextOption<T extends string>(
  order: readonly T[],
  current: T,
  key: string,
): T | null {
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

// A segmented control that switches what the content under it shows (a
// table's view, a year): tabs over one panel, the chosen one raised. Arrow
// keys move between them.
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  controls,
  pending = false,
  className,
}: {
  // The tablist's accessible name ("Años").
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  // The id of the panel the tabs switch.
  controls?: string;
  pending?: boolean;
  className?: string;
}) {
  const base = useId();
  const order = options.map((each) => each.value);
  const tabId = (each: T) => `${base}-${each}`;
  const choose = (next: T) => {
    if (pending || next === value) return;
    onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextOption(order, value, event.key);
    if (!next) return;
    event.preventDefault();
    if (pending) return;
    choose(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      data-slot="segmented"
      className={cn(
        "bg-muted inline-flex h-7 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-md p-0.5",
        className,
      )}
    >
      {options.map((each) => (
        <button
          key={each.value}
          id={tabId(each.value)}
          type="button"
          role="tab"
          aria-selected={each.value === value}
          aria-controls={controls}
          aria-disabled={pending || undefined}
          tabIndex={each.value === value ? 0 : -1}
          onClick={() => choose(each.value)}
          onKeyDown={onKeyDown}
          className={cn(
            "focus-visible:ring-ring h-full rounded-sm px-2.5 text-xs font-medium whitespace-nowrap tabular-nums outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed",
            each.value === value
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {each.label}
          {each.count !== undefined && (
            <>
              {" "}
              <span className="text-muted-foreground">{each.count}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
