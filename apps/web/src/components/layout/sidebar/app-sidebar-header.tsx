"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { AppSidebarLogoLink } from "@/components/layout/sidebar/app-sidebar-logo-link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { usePageCrumbs } from "@/components/layout/page-crumbs";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { routeItemForPath } from "@/lib/navigation";

export function AppSidebarHeader() {
  const title = routeItemForPath(usePathname())?.title;
  const crumbs = usePageCrumbs();
  const trail = crumbs ?? (title ? [{ label: title }] : []);

  return (
    // Sticky over the scrolling canvas, with the canvas card's surface and
    // hairline so it reads as part of the card.
    <header
      className="sticky top-0 z-20 shrink-0 border-b-[0.5px] border-canvas-border bg-canvas p-4"
      data-print="hidden"
    >
      <div className="flex h-7 w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          {trail.length > 0 && (
            <Breadcrumb>
              <BreadcrumbList className="text-xs">
                {trail.map((crumb, index) => (
                  <Fragment key={`${index}-${crumb.label}`}>
                    {index > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem
                      className={
                        index < trail.length - 1 ? "hidden md:inline-flex" : ""
                      }
                    >
                      {crumb.href && index < trail.length - 1 ? (
                        <BreadcrumbLink asChild>
                          <Link href={crumb.href}>{crumb.label}</Link>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage className="max-w-48 truncate">
                          {crumb.label}
                        </BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          )}
        </div>
        <AppSidebarLogoLink />
      </div>
    </header>
  );
}
