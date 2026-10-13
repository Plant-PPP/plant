"use client";

import { ChevronDownIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { type KeyboardEvent, useRef, useState } from "react";

import { folded } from "@/lib/format/text";
import { instrumentLabel } from "@/lib/holdings/holding-name";
import type { InstrumentRow } from "@/lib/holdings/read";
import { cn } from "@/lib/utils";

type PickerInstrument = Pick<InstrumentRow, "symbol" | "name">;

// Whether an instrument's symbol or name holds the typed text, case and
// accents ignored.
export function matchesInstrument(
  instrument: PickerInstrument,
  query: string,
): boolean {
  const wanted = folded(query.trim());
  return (
    folded(instrument.symbol).includes(wanted) ||
    folded(instrument.name).includes(wanted)
  );
}

// What a key in the search does: move the active option (wrapping), pick it,
// close the list, or nothing ("stay"), each with the key's default prevented;
// null for a key the search types as text.
export type SearchKey =
  | { kind: "move"; active: number }
  | { kind: "choose"; index: number }
  | { kind: "close" }
  | { kind: "stay" };

export function searchKey(
  key: string,
  active: number,
  count: number,
): SearchKey | null {
  switch (key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (count === 0) return { kind: "stay" };
      const step = key === "ArrowDown" ? 1 : -1;
      return { kind: "move", active: (active + step + count) % count };
    }
    case "Enter":
      return active < count
        ? { kind: "choose", index: active }
        : { kind: "stay" };
    case "Tab":
      return { kind: "close" };
    default:
      return null;
  }
}

// The search a key on the closed trigger opens with, as a select's would: an
// arrow opens it empty and a typed character starts the search; null for any
// other key.
export function triggerKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): string | null {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") return "";
  const typed =
    event.key.length === 1 &&
    event.key !== " " &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey;
  return typed ? event.key : null;
}

// An instrument choice that searches by symbol or name. The trigger takes the
// field's id, so its <Label htmlFor> and a refused submit's focus reach it;
// its name is the label and the chosen instrument. What is typed only
// filters: the value is always an instrument of the list.
export function InstrumentPicker({
  id,
  labelId,
  instruments,
  value,
  onChange,
  placeholder,
  autoFocus,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  labelId: string;
  instruments: readonly PickerInstrument[];
  value: string;
  onChange: (symbol: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = open
    ? instruments.filter((each) => matchesInstrument(each, query))
    : [];
  const chosen = instruments.find((each) => each.symbol === value);
  const valueId = `${id}-value`;
  const listId = `${id}-list`;
  const optionId = (symbol: string) => `${id}-${symbol}`;
  const activeSymbol = shown[active]?.symbol;
  const activeId =
    activeSymbol === undefined ? undefined : optionId(activeSymbol);

  const searchInput = useRef<HTMLInputElement>(null);
  // How the active option scrolls into view: to the top on opening, as Radix
  // may then shrink the list from the bottom; into view on keys and typing;
  // never on hover, which would scroll the list under the pointer.
  const followActive = useRef<ScrollLogicalPosition | null>(null);

  function openWith(next: boolean, search = "") {
    if (next) {
      followActive.current = "start";
      setQuery(search);
      setActive(
        Math.max(
          0,
          search === ""
            ? instruments.findIndex((each) => each.symbol === value)
            : 0,
        ),
      );
    }
    setOpen(next);
  }

  function choose(symbol: string) {
    onChange(symbol);
    setOpen(false);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const action = searchKey(event.key, active, shown.length);
    if (!action) return;
    event.preventDefault();
    if (action.kind === "move") {
      followActive.current = "nearest";
      setActive(action.active);
    }
    if (action.kind === "choose") choose(shown[action.index]!.symbol);
    if (action.kind === "close") setOpen(false);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open) return;
    const search = triggerKey(event);
    if (search === null) return;
    event.preventDefault();
    openWith(true, search);
  }

  return (
    <Popover.Root open={open} onOpenChange={openWith}>
      <Popover.Trigger
        id={id}
        type="button"
        autoFocus={autoFocus}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-labelledby={`${labelId} ${valueId}`}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]",
          !chosen && "text-muted-foreground",
        )}
      >
        <span id={valueId} className="truncate">
          {chosen ? instrumentLabel(chosen.symbol, chosen.name) : placeholder}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          // Radix would focus the search with its text selected, so the next
          // key would replace a character typed on the trigger.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const input = searchInput.current;
            input?.focus({ preventScroll: true });
            input?.setSelectionRange(input.value.length, input.value.length);
          }}
          aria-label="Elegir instrumento"
          className="z-50 grid w-(--radix-popover-trigger-width) gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <input
            ref={searchInput}
            id={`${id}-search`}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Buscar instrumento"
            placeholder="Buscá por símbolo o nombre"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              followActive.current = "nearest";
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            className="h-8 w-full rounded-sm border-b bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {/* Always in the accessibility tree, so "Sin resultados" is announced
              when the list empties, not only when it mounts. */}
          <p
            role="status"
            className={
              shown.length === 0
                ? "px-2 text-sm text-muted-foreground"
                : "sr-only"
            }
          >
            {shown.length === 0 ? "Sin resultados" : ""}
          </p>
          <ul
            id={listId}
            role="listbox"
            aria-label="Instrumentos"
            // Capped from its first render, before Radix measures the room
            // left, so the active option can scroll into view on opening.
            className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height,21rem)-3rem))] overflow-y-auto"
          >
            {shown.map((each, index) => (
              <li
                key={each.symbol}
                id={optionId(each.symbol)}
                role="option"
                aria-selected={each.symbol === value}
                data-active={index === active || undefined}
                // The active option scrolls into view once it is in the page,
                // which the portal mounts a render after it opens.
                ref={
                  index === active
                    ? (option) => {
                        if (option && followActive.current) {
                          option.scrollIntoView({
                            block: followActive.current,
                          });
                          // To the top once per opening: a later render keeps
                          // it in view without pulling it back up.
                          followActive.current = "nearest";
                        }
                      }
                    : undefined
                }
                // Keeps focus in the search while the click picks.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  followActive.current = null;
                  setActive(index);
                }}
                onClick={() => choose(each.symbol)}
                className="cursor-default truncate rounded-sm px-2 py-1.5 text-sm aria-selected:font-medium data-active:bg-accent data-active:text-accent-foreground"
              >
                {instrumentLabel(each.symbol, each.name)}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
