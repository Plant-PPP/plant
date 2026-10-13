"use client";

import { ChevronDownIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { type KeyboardEvent, useEffect, useState } from "react";

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
  const shown = instruments.filter((each) => matchesInstrument(each, query));
  const chosen = instruments.find((each) => each.symbol === value);
  const valueId = `${id}-value`;
  const listId = `${id}-list`;
  const optionId = (symbol: string) => `${id}-${symbol}`;
  const activeSymbol = shown[active]?.symbol;
  const activeId =
    activeSymbol === undefined ? undefined : optionId(activeSymbol);

  useEffect(() => {
    if (open && activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeId]);

  function openWith(next: boolean) {
    if (next) {
      setQuery("");
      setActive(
        Math.max(
          0,
          instruments.findIndex((each) => each.symbol === value),
        ),
      );
    }
    setOpen(next);
  }

  function choose(symbol: string) {
    onChange(symbol);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + shown.length) % shown.length);
    } else if (event.key === "Enter") {
      // Inside a form, Enter would submit it.
      event.preventDefault();
      if (activeSymbol !== undefined) choose(activeSymbol);
    } else if (event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
    }
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
          aria-label="Elegir instrumento"
          className="z-50 grid w-(--radix-popover-trigger-width) gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <input
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
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-8 w-full rounded-sm border-b bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Sin resultados
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label="Instrumentos"
              className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-3rem))] overflow-y-auto"
            >
              {shown.map((each, index) => (
                <li
                  key={each.symbol}
                  id={optionId(each.symbol)}
                  role="option"
                  aria-selected={each.symbol === value}
                  data-active={index === active || undefined}
                  // Keeps focus in the search while the click picks.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(each.symbol)}
                  className="cursor-default truncate rounded-sm px-2 py-1.5 text-sm aria-selected:font-medium data-active:bg-accent data-active:text-accent-foreground"
                >
                  {instrumentLabel(each.symbol, each.name)}
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
