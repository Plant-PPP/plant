import type * as React from "react";

import { cn } from "@/lib/utils";

function FormAlert({
  className,
  ...props
}: Omit<React.ComponentProps<"p">, "role">) {
  return (
    <p
      data-slot="form-alert"
      className={cn("text-sm text-destructive", className)}
      {...props}
      role="alert"
    />
  );
}

export { FormAlert };
