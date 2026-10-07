"use client";

import { usePathname } from "next/navigation";
import { AppSidebarLogoLink } from "@/components/layout/sidebar/app-sidebar-logo-link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { navItemForPath } from "@/lib/navigation";

export function AppSidebarHeader() {
  const title = navItemForPath(usePathname())?.title;

  return (
    // Sticky card header: p-4 around a fixed 28px (h-7) content row, closed
    // by the same hairline border the shell cards use, so every card header
    // is exactly 60px tall. Stays pinned while the canvas scrolls.
    <header className="sticky top-0 z-20 shrink-0 border-b-[0.5px] bg-background p-4 dark:border-[#2e2e2e] dark:bg-[#171717]">
      <div className="flex h-7 w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          {title && (
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-xs">{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          )}
        </div>
        <AppSidebarLogoLink />
      </div>
    </header>
  );
}
