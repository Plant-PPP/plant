import * as React from "react";

import { typedAmount } from "@/lib/format/typed-amount";
import { cn } from "@/lib/utils";

// An amount field (inputMode decimal) keeps, as it is typed or pasted, only
// what can still become an amount.
function Input({
  className,
  type,
  inputMode,
  onChange,
  ...props
}: React.ComponentProps<"input">) {
  const change =
    inputMode === "decimal" && onChange
      ? (event: React.ChangeEvent<HTMLInputElement>) => {
          const kept = typedAmount(event.target.value);
          if (kept !== event.target.value) event.target.value = kept;
          onChange(event);
        }
      : onChange;
  return (
    <input
      type={type}
      inputMode={inputMode}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      onChange={change}
      {...props}
    />
  );
}

export { Input };
