"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { choose } from "@/components/portfolio-setup/field-alert";

// A select that narrows what a page shows, its label read by screen readers
// (and shown inside it with `shownLabel`); it waits while a write runs.
export function FilterSelect({
  id,
  label,
  shownLabel = false,
  value,
  pending,
  options,
  onChange,
}: {
  id: string;
  label: string;
  // Shown inside the select, for a value that does not say what it is.
  shownLabel?: boolean;
  value: string;
  pending: boolean;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select disabled={pending} value={value} onValueChange={choose(onChange)}>
        <SelectTrigger
          id={id}
          size="sm"
          className="w-[calc(50%-0.25rem)] sm:w-auto"
        >
          {shownLabel && (
            <span
              aria-hidden
              className="text-muted-foreground hidden sm:inline"
            >
              {label}
            </span>
          )}
          {/* The chosen option's text, so the server render shows it too. */}
          <SelectValue>
            {options.find(([option]) => option === value)?.[1]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map(([option, text]) => (
            <SelectItem key={option} value={option}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
