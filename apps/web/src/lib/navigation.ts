import {
  Bot,
  ChartNoAxesColumn,
  Landmark,
  Settings2,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { isUnder } from "./paths";

export type RouteItem = {
  href: string;
  title: string;
  icon: LucideIcon;
};

export type NavItem = RouteItem & { primary: boolean };

export const NAV_ITEMS = [
  { href: "/assistant", title: "Asistente", icon: Bot, primary: true },
  { href: "/", title: "Resumen", icon: ChartNoAxesColumn, primary: false },
  { href: "/assets", title: "Activos", icon: Wallet, primary: false },
  { href: "/debts", title: "Deudas", icon: Landmark, primary: false },
  { href: "/import", title: "Cargar", icon: Upload, primary: false },
] as const satisfies readonly NavItem[];

// Reached from the user menu, not the sidebar.
export const SETTINGS_ITEM = {
  href: "/settings",
  title: "Ajustes",
  icon: Settings2,
} as const satisfies RouteItem;

const ROUTE_ITEMS = [...NAV_ITEMS, SETTINGS_ITEM] as const;

export type RouteHref = (typeof ROUTE_ITEMS)[number]["href"];

export function routeItemForPath(pathname: string): RouteItem | undefined {
  return ROUTE_ITEMS.find((item) => isUnder(item.href, pathname));
}

export function navTitle(href: RouteHref): string {
  return ROUTE_ITEMS.find((item) => item.href === href)!.title;
}
