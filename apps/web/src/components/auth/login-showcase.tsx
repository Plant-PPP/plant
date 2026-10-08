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

const ASSETS: {
  label: string;
  icon: LucideIcon;
  color: string;
  top: string;
  left: string;
}[] = [
  {
    label: "Acciones",
    icon: ChartLine,
    color: "--chart-1",
    top: "14%",
    left: "16%",
  },
  {
    label: "CEDEARs",
    icon: Globe,
    color: "--chart-5",
    top: "10%",
    left: "62%",
  },
  {
    label: "Bonos",
    icon: Landmark,
    color: "--chart-7",
    top: "30%",
    left: "80%",
  },
  {
    label: "Cripto",
    icon: Bitcoin,
    color: "--chart-2",
    top: "32%",
    left: "6%",
  },
  {
    label: "Dólares",
    icon: Banknote,
    color: "--chart-3",
    top: "66%",
    left: "10%",
  },
  {
    label: "Plazo fijo",
    icon: PiggyBank,
    color: "--chart-4",
    top: "70%",
    left: "74%",
  },
  { label: "FCI", icon: ChartPie, color: "--chart-6", top: "84%", left: "36%" },
  {
    label: "Inmuebles",
    icon: Building2,
    color: "--chart-8",
    top: "86%",
    left: "60%",
  },
];

const RINGS = [90, 180, 270, 360, 450, 540];

// Decorative panel beside the login form; screen readers skip it.
export function LoginShowcase() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden overflow-hidden bg-brand/15 lg:block"
    >
      <svg
        className="absolute top-1/2 left-1/2 size-[1100px] -translate-x-1/2 -translate-y-1/2 text-brand"
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
      {ASSETS.map(({ label, icon: Icon, color, top, left }) => (
        <div
          key={label}
          className="absolute flex items-center gap-2 rounded-xl border bg-background/90 px-3 py-2 text-sm font-medium shadow-sm"
          style={{ top, left }}
        >
          <span
            className="flex size-8 items-center justify-center rounded-lg"
            style={{
              backgroundColor: `color-mix(in oklab, var(${color}) 25%, transparent)`,
              color: `var(${color})`,
            }}
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
