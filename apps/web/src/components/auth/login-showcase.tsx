import {
  Banknote,
  Bitcoin,
  Building2,
  ChartLine,
  ChartPie,
  Globe,
  Landmark,
  PiggyBank,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ASSETS: {
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  position: string;
}[] = [
  {
    label: "Acciones",
    icon: ChartLine,
    iconClassName: "bg-chart-1/25 text-chart-1",
    position: "top-[14%] left-[16%]",
  },
  {
    label: "CEDEARs",
    icon: Globe,
    iconClassName: "bg-chart-5/25 text-chart-5",
    position: "top-[10%] right-[12%]",
  },
  {
    label: "Bonos",
    icon: Landmark,
    iconClassName: "bg-chart-7/25 text-chart-7",
    position: "top-[30%] right-[4%]",
  },
  {
    label: "Cripto",
    icon: Bitcoin,
    iconClassName: "bg-chart-2/25 text-chart-2",
    position: "top-[32%] left-[6%]",
  },
  {
    label: "Dólares",
    icon: Banknote,
    iconClassName: "bg-chart-3/25 text-chart-3",
    position: "top-[66%] left-[10%]",
  },
  {
    label: "Plazo fijo",
    icon: PiggyBank,
    iconClassName: "bg-chart-4/25 text-chart-4",
    position: "top-[70%] right-[6%]",
  },
  {
    label: "FCI",
    icon: ChartPie,
    iconClassName: "bg-chart-6/25 text-chart-6",
    position: "top-[84%] left-[36%]",
  },
  {
    label: "Inmuebles",
    icon: Building2,
    iconClassName: "bg-chart-8/25 text-chart-8",
    position: "top-[86%] right-[18%]",
  },
];

const RINGS = [90, 180, 270, 360, 450, 540];

export function LoginShowcase() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden overflow-hidden bg-brand/15 lg:block"
    >
      <svg
        className="absolute top-1/2 left-1/2 size-[max(1100px,150%)] -translate-x-1/2 -translate-y-1/2 text-brand"
        viewBox="-550 -550 1100 1100"
        fill="none"
      >
        {RINGS.map((r, i) => (
          <circle
            key={r}
            r={r}
            stroke="currentColor"
            strokeWidth={i === 0 ? 24 : 2}
            strokeOpacity={0.5 - i * 0.07}
          />
        ))}
      </svg>
      {ASSETS.map(({ label, icon: Icon, iconClassName, position }) => (
        <div
          key={label}
          className={cn(
            "absolute flex items-center gap-2 rounded-xl border bg-background/90 px-3 py-2 text-sm font-medium whitespace-nowrap shadow-sm",
            position,
          )}
        >
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              iconClassName,
            )}
          >
            <Icon className="size-4" />
          </span>
          {label}
        </div>
      ))}
      <div className="absolute top-1/2 left-1/2 flex w-[min(80%,30rem)] -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-2xl border bg-background px-5 py-4 text-lg shadow-lg">
        <Sparkles className="size-5 shrink-0 text-muted-foreground" />
        ¿Cuánto vale mi patrimonio en dólares MEP?
      </div>
    </div>
  );
}
