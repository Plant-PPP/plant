import {
  Bot,
  ChartNoAxesColumn,
  Landmark,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  title: string;
  icon: LucideIcon;
  primary: boolean;
};

export const NAV_ITEMS = [
  { href: "/assistant", title: "Asistente", icon: Bot, primary: true },
  { href: "/", title: "Resumen", icon: ChartNoAxesColumn, primary: false },
  { href: "/assets", title: "Activos", icon: Wallet, primary: false },
  { href: "/debts", title: "Deudas", icon: Landmark, primary: false },
  { href: "/import", title: "Cargar", icon: Upload, primary: false },
] as const satisfies readonly NavItem[];

export type NavHref = (typeof NAV_ITEMS)[number]["href"];

export function navItemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    item.href === "/"
      ? pathname === "/"
      : pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

export function navTitle(href: NavHref): string {
  return NAV_ITEMS.find((item) => item.href === href)!.title;
}
