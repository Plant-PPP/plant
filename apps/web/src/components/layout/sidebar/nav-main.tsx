"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_ITEMS, navItemForPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const PRIMARY_BUTTON =
  "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary/90 data-[active=true]:text-primary-foreground focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

type Item = (typeof NAV_ITEMS)[number];

function NavLinks({ items }: { items: readonly Item[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const activeHref = navItemForPath(pathname)?.href;

  return (
    <SidebarMenu>
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              asChild
              size="sm"
              isActive={isActive}
              className={cn("text-xs", item.primary && PRIMARY_BUTTON)}
            >
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setOpenMobile(false)}
              >
                <item.icon />
                <span className={isActive ? "font-bold" : ""}>
                  {item.title}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function NavMain() {
  return (
    <nav aria-label="Principal">
      <SidebarGroup>
        <NavLinks items={NAV_ITEMS.filter((item) => item.primary)} />
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Plataforma</SidebarGroupLabel>
        <NavLinks items={NAV_ITEMS.filter((item) => !item.primary)} />
      </SidebarGroup>
    </nav>
  );
}
