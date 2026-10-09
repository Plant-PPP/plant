"use client";

import { useState } from "react";
import { OTP_LENGTH } from "@/lib/auth/otp-config";
import { mergeAuthCode } from "@/lib/auth/merge-auth-code";
import { cn } from "@/lib/utils";

// One transparent input spans the boxes, so paste, one-time-code autofill and
// screen readers see a single field.
export function CodeInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, OTP_LENGTH - 1);

  return (
    <span className="relative flex">
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            "pointer-events-none relative flex h-11 flex-1 items-center justify-center border-y border-r border-input font-mono text-lg font-medium first:rounded-l-md first:border-l dark:bg-input/30",
            i === OTP_LENGTH - 1 && "rounded-r-md",
            focused &&
              i === active &&
              "z-10 border-ring ring-[3px] ring-ring/50 forced-colors:outline-2 forced-colors:outline-[Highlight]",
          )}
        >
          {value[i]}
          {focused && i === value.length && (
            <span className="h-5 w-px bg-foreground forced-color-adjust-none motion-safe:animate-pulse forced-colors:bg-[CanvasText]" />
          )}
        </span>
      ))}
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        autoFocus
        value={value}
        onChange={(event) => {
          const native = event.nativeEvent;
          const autofill =
            native instanceof InputEvent &&
            native.inputType === "insertReplacementText";
          onChange(mergeAuthCode(value, event.target.value, autofill));
        }}
        // A paste reaches the field with its line breaks turned into spaces,
        // and a drop lands where the pointer is; both read the raw text here.
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text");
          onChange(mergeAuthCode(value, value + text));
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          const text = event.dataTransfer.getData("text");
          onChange(mergeAuthCode(value, value + text));
        }}
        // The boxes show no selection, only a caret after the last digit, so
        // the caret is kept there.
        onSelect={(event) => {
          const input = event.currentTarget;
          const end = input.value.length;
          if (input.selectionStart !== end || input.selectionEnd !== end) {
            input.setSelectionRange(end, end);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Browsers paint autofilled fields with !important colours; the text
        // fill and a delayed background keep the boxes visible underneath.
        className="absolute inset-0 size-full bg-transparent text-base text-transparent forced-color-adjust-none caret-transparent outline-none selection:bg-transparent autofill:transition-[background-color] autofill:delay-[99999s] autofill:[-webkit-text-fill-color:transparent]"
      />
    </span>
  );
}
