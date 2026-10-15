"use client";

import type * as React from "react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

// What the user must fix to send a form: a toast, raised once per message,
// and the same text hidden beside the field, where `aria-describedby` points,
// so a screen reader reads it again on the field.
function FormAlert({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"p">, "role">) {
  const text = useRef<HTMLParagraphElement>(null);
  const raised = useRef<string | null>(null);
  useEffect(() => {
    const message = text.current?.textContent ?? "";
    if (!message || message === raised.current) return;
    raised.current = message;
    toast.error(children);
  });
  return (
    <p
      ref={text}
      className={cn("sr-only", className)}
      {...props}
      data-slot="form-alert"
    >
      {children}
    </p>
  );
}

export { FormAlert };
