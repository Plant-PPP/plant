"use client";

import { useState } from "react";
import { OTP_LENGTH } from "@/lib/auth/otp-config";
import { sanitizeAuthCode } from "@/lib/auth/sanitize-auth-code";
import { cn } from "@/lib/utils";

// One transparent input spans the boxes, so paste, one-time-code autofill and
// screen readers see a single field.
export function CodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, OTP_LENGTH - 1);

  return (
    <div className="relative flex">
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            "relative flex h-11 flex-1 items-center justify-center border-y border-r border-input font-mono text-lg font-medium first:rounded-l-md first:border-l last:rounded-r-md dark:bg-input/30",
            focused &&
              i === active &&
              "z-10 border-ring ring-[3px] ring-ring/50",
          )}
        >
          {value[i]}
          {focused && i === value.length && (
            <span className="h-5 w-px animate-pulse bg-foreground" />
          )}
        </div>
      ))}
      <input
        aria-label="Código"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        autoFocus
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(sanitizeAuthCode(event.target.value))}
        // Typing always appends: the caret stays after the last digit.
        onSelect={(event) => {
          const end = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(end, end);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-0 size-full bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent disabled:cursor-not-allowed"
      />
    </div>
  );
}
