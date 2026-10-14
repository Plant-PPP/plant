"use client";

import type { Listing } from "@plant/core";
import { ChevronDownIcon } from "lucide-react";
import { Popover } from "radix-ui";
import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { folded } from "@/lib/format/text";
import { HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";
import { instrumentLabel } from "@/lib/holdings/holding-name";
import type { InstrumentRow } from "@/lib/holdings/read";
import { settle } from "@/lib/server-action-call";
import { cn } from "@/lib/utils";

import { useInstrumentMarket } from "./instrument-market";

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

// What a market listing shows besides its name: its type, currency and
// market, as "Acción · ARS · BYMA".
export const listingDetail = ({ type, currency, market }: Listing): string =>
  [
    HOLDING_CLASS_LABELS[type],
    currency,
    market === "byma" ? "BYMA" : "Cripto",
  ].join(" · ");

// The market listings the picker offers: those the catalog does not have yet.
export const newListings = (
  listings: readonly Listing[],
  instruments: readonly PickerInstrument[],
): Listing[] => {
  const held = new Set(instruments.map(({ symbol }) => symbol));
  return listings.filter(({ symbol }) => !held.has(symbol));
};

// The shortest text the market is searched for, and how long typing pauses
// before it is.
export const MARKET_QUERY_MIN = 2;
const MARKET_DELAY_MS = 300;

const MARKET_FAILURES: Record<string, string> = {
  limited: "Buscaste muchas veces seguidas. Esperá un minuto.",
  unavailable: "No pudimos buscar en el mercado. Probá de nuevo en un rato.",
  invalid: "Escribí un símbolo o un nombre más corto.",
  not_listed: "Ese instrumento ya no figura en el mercado.",
  failed: "No pudimos agregarlo. Probá de nuevo más tarde.",
  rejected: "No pudimos buscar en el mercado. Probá de nuevo en un rato.",
};

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

// What names the picker: the id of a visible label, or the name itself where
// the field shows none.
type PickerName =
  | { labelId: string; "aria-label"?: never }
  | { "aria-label": string; labelId?: never };

// An instrument choice that searches by symbol or name. The trigger takes the
// field's id, so its <Label htmlFor> and a refused submit's focus reach it;
// its name is the label and the chosen instrument. What is typed only
// filters: the value is always an instrument of the list. With onAdded, the
// search also looks in the market, and picking a listing adds it to the
// catalog first, where a page provides the market's actions.
export function InstrumentPicker({
  id,
  labelId,
  "aria-label": ariaLabel,
  instruments,
  value,
  onChange,
  placeholder,
  autoFocus,
  onAdded,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: PickerName & {
  id: string;
  instruments: readonly PickerInstrument[];
  value: string;
  // added is the instrument a listing just added, which the page's list does
  // not hold yet.
  onChange: (symbol: string, added?: InstrumentRow) => void;
  placeholder: string;
  autoFocus?: boolean;
  onAdded?: (instrument: InstrumentRow) => void;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const actions = useInstrumentMarket();
  const searchMarket = onAdded && actions ? actions : null;
  const [market, setMarket] = useState<{
    query: string;
    listings: Listing[];
  } | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const shown = open
    ? instruments.filter((each) => matchesInstrument(each, query))
    : [];
  const marketShown =
    open && searchMarket && market && market.query === query.trim()
      ? newListings(market.listings, instruments)
      : [];
  const optionCount = shown.length + marketShown.length;
  const chosen = instruments.find((each) => each.symbol === value);

  // The market is searched once typing pauses; an answer to an older text is
  // dropped.
  const wanted = query.trim();
  useEffect(() => {
    if (!open || !searchMarket || wanted.length < MARKET_QUERY_MIN) return;
    let current = true;
    const timer = setTimeout(() => {
      void settle(searchMarket.search(wanted)).then((result) => {
        if (!current) return;
        if (result === "rejected") {
          setMarketError(MARKET_FAILURES.rejected!);
        } else if (result.ok) {
          setMarketError(null);
          setMarket({ query: wanted, listings: result.listings });
        } else {
          setMarketError(MARKET_FAILURES[result.code] ?? null);
        }
      });
    }, MARKET_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, searchMarket, wanted]);
  const valueId = `${id}-value`;
  const nameId = labelId ?? `${id}-label`;
  const listId = `${id}-list`;
  const optionId = (symbol: string) => `${id}-${symbol}`;
  const marketId = (symbol: string) => `${id}-market-${symbol}`;
  const activeId =
    active < shown.length
      ? optionId(shown[active]!.symbol)
      : marketShown[active - shown.length]
        ? marketId(marketShown[active - shown.length]!.symbol)
        : undefined;

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

  function chooseListing(listing: Listing) {
    if (!onAdded || !searchMarket || adding) return;
    setMarketError(null);
    startAdding(async () => {
      const result = await settle(
        searchMarket.add(listing.symbol, listing.market),
      );
      if (result === "rejected") {
        setMarketError(MARKET_FAILURES.failed!);
        return;
      }
      if (!result.ok) {
        setMarketError(MARKET_FAILURES[result.code] ?? null);
        return;
      }
      onAdded(result.instrument);
      onChange(result.instrument.symbol, result.instrument);
      setOpen(false);
    });
  }

  function chooseAt(index: number) {
    if (index < shown.length) choose(shown[index]!.symbol);
    else chooseListing(marketShown[index - shown.length]!);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const action = searchKey(event.key, active, optionCount);
    if (!action) return;
    event.preventDefault();
    if (action.kind === "move") {
      followActive.current = "nearest";
      setActive(action.active);
    }
    if (action.kind === "choose") chooseAt(action.index);
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
        // Read as a select by dialogs: its scale, and "nothing chosen" while
        // it shows the placeholder.
        data-slot="select-trigger"
        data-placeholder={chosen ? undefined : ""}
        autoFocus={autoFocus}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-labelledby={`${nameId} ${valueId}`}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]",
          !chosen && "text-muted-foreground",
        )}
      >
        {labelId === undefined && (
          <span id={nameId} className="sr-only">
            {ariaLabel}
          </span>
        )}
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
            placeholder={
              searchMarket
                ? "Buscá por símbolo o nombre, también en el mercado"
                : "Buscá por símbolo o nombre"
            }
            autoComplete="off"
            value={query}
            onChange={(event) => {
              followActive.current = "nearest";
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            className="h-8 w-full rounded-sm border-b bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
          />
          {/* Always in the accessibility tree, so "Sin resultados" is announced
              when the list empties, not only when it mounts. */}
          <p
            role="status"
            className={
              optionCount === 0 || marketError || adding
                ? "px-2 text-xs text-muted-foreground"
                : "sr-only"
            }
          >
            {adding
              ? "Agregando…"
              : (marketError ?? (optionCount === 0 ? "Sin resultados" : ""))}
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
                className="cursor-default truncate rounded-sm px-2 py-1.5 text-xs aria-selected:font-medium data-active:bg-accent data-active:text-accent-foreground"
              >
                {instrumentLabel(each.symbol, each.name)}
              </li>
            ))}
            {marketShown.length > 0 && (
              <li
                role="presentation"
                className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
              >
                En el mercado
              </li>
            )}
            {marketShown.map((listing, index) => (
              <li
                key={`market-${listing.symbol}`}
                id={marketId(listing.symbol)}
                role="option"
                aria-selected={false}
                aria-disabled={adding || undefined}
                data-active={shown.length + index === active || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  followActive.current = null;
                  setActive(shown.length + index);
                }}
                onClick={() => chooseListing(listing)}
                className="grid cursor-default rounded-sm px-2 py-1.5 text-xs data-active:bg-accent data-active:text-accent-foreground"
              >
                <span className="truncate">
                  {instrumentLabel(listing.symbol, listing.name)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {listingDetail(listing)}
                </span>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
