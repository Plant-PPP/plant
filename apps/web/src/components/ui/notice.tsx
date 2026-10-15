import {
  CircleAlert,
  CircleCheck,
  Info,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

// Each variant's glow: its token faded in along the four edges. Full class
// literals, so Tailwind generates them.
const VARIANTS = {
  info: {
    icon: Info,
    tint: "text-primary",
    glow: "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--primary)_7%,transparent),transparent_clamp(44px,16%,120px),transparent_calc(100%_-_clamp(44px,16%,120px)),color-mix(in_oklab,var(--primary)_7%,transparent)),linear-gradient(180deg,color-mix(in_oklab,var(--primary)_7%,transparent),transparent_clamp(8px,16%,16px),transparent_calc(100%_-_clamp(8px,16%,16px)),color-mix(in_oklab,var(--primary)_7%,transparent))]",
  },
  warning: {
    icon: TriangleAlert,
    tint: "text-warn",
    glow: "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--warn)_8%,transparent),transparent_clamp(44px,16%,120px),transparent_calc(100%_-_clamp(44px,16%,120px)),color-mix(in_oklab,var(--warn)_8%,transparent)),linear-gradient(180deg,color-mix(in_oklab,var(--warn)_8%,transparent),transparent_clamp(8px,16%,16px),transparent_calc(100%_-_clamp(8px,16%,16px)),color-mix(in_oklab,var(--warn)_8%,transparent))]",
  },
  error: {
    icon: CircleAlert,
    tint: "text-destructive",
    glow: "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--destructive)_8%,transparent),transparent_clamp(44px,16%,120px),transparent_calc(100%_-_clamp(44px,16%,120px)),color-mix(in_oklab,var(--destructive)_8%,transparent)),linear-gradient(180deg,color-mix(in_oklab,var(--destructive)_8%,transparent),transparent_clamp(8px,16%,16px),transparent_calc(100%_-_clamp(8px,16%,16px)),color-mix(in_oklab,var(--destructive)_8%,transparent))]",
  },
  success: {
    icon: CircleCheck,
    tint: "text-gain",
    glow: "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--gain)_7%,transparent),transparent_clamp(44px,16%,120px),transparent_calc(100%_-_clamp(44px,16%,120px)),color-mix(in_oklab,var(--gain)_7%,transparent)),linear-gradient(180deg,color-mix(in_oklab,var(--gain)_7%,transparent),transparent_clamp(8px,16%,16px),transparent_calc(100%_-_clamp(8px,16%,16px)),color-mix(in_oklab,var(--gain)_7%,transparent))]",
  },
} satisfies Record<string, { icon: LucideIcon; tint: string; glow: string }>;

export type NoticeVariant = keyof typeof VARIANTS;

// State the user should know about, inline in a section or as a page banner:
// a quiet panel with a hairline border, its edges glowing faintly in the
// variant's color, the variant's icon, an optional title, the text and an
// optional action. The text keeps the foreground color, so only the icon and
// the glow carry the variant. An error is announced as an alert, the rest
// politely.
function Notice({
  variant = "info",
  icon,
  title,
  action,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "role" | "title"> & {
  variant?: NoticeVariant;
  // Replaces the variant's icon, as a bell for price alerts.
  icon?: LucideIcon;
  title?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { icon: VariantIcon, tint, glow } = VARIANTS[variant];
  const Icon = icon ?? VariantIcon;
  return (
    <div
      data-slot="notice"
      data-variant={variant}
      {...props}
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "border-primary/15 bg-muted/40 relative rounded-lg border p-3 text-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit]",
          glow,
        )}
      />
      <div
        className={cn(
          "relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
          title ? "items-start" : "items-center",
        )}
      >
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", title && "mt-0.5", tint)}
        />
        <div className="grid gap-0.5">
          {title && <p className="font-medium">{title}</p>}
          <div className={cn(title && "text-muted-foreground")}>{children}</div>
        </div>
        {action && (
          <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1 sm:self-center">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

export { Notice };
