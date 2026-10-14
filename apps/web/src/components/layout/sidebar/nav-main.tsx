"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_ITEMS, routeItemForPath } from "@/lib/navigation";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { isUnder } from "@/lib/paths";
import { isAssistantShortcut, useMac } from "@/lib/platform";
import { cn } from "@/lib/utils";

const PRIMARY_BUTTON =
  "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary/90 data-[active=true]:text-primary-foreground focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

type Item = (typeof NAV_ITEMS)[number];

function NavLinks({ items }: { items: readonly Item[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const activeHref = routeItemForPath(pathname)?.href;
  const mac = useMac();
  const assistant = items.find((item) => item.primary);

  // ⌘K opens the assistant from any page; on the assistant itself its field
  // takes the shortcut.
  useEffect(() => {
    if (!assistant || isUnder(assistant.href, pathname)) return;
    function open(event: KeyboardEvent) {
      if (!isAssistantShortcut(event)) return;
      event.preventDefault();
      router.push(assistant!.href);
    }
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [assistant, pathname, router]);

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
                {item.primary && (
                  <KbdGroup
                    aria-hidden
                    className="ml-auto hidden md:inline-flex"
                  >
                    <Kbd className="bg-primary-foreground/15 text-primary-foreground h-4 min-w-4 text-[10px]">
                      {mac ? "⌘" : "Ctrl"}
                    </Kbd>
                    <Kbd className="bg-primary-foreground/15 text-primary-foreground h-4 min-w-4 text-[10px]">
                      K
                    </Kbd>
                  </KbdGroup>
                )}
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
