import type * as React from "react";

import { cn } from "@/lib/utils";

function FormAlert({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      role="alert"
      data-slot="form-alert"
      className={cn("text-sm text-destructive", className)}
      {...props}
    />
  );
}

export { FormAlert };
