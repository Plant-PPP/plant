import Link from "next/link";
import { BrandLogo } from "@/components/layout/brand-logo";
import { NavMain } from "@/components/layout/sidebar/nav-main";
import { NavSecondary } from "@/components/layout/sidebar/nav-secondary";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  return (
    // `border-r-0` removes the hardcoded right border on the sidebar container
    // so it melts into the page background (shadcn inset).
    <Sidebar variant="inset" collapsible="offcanvas" className="border-r-0">
      <SidebarHeader>
        <Link href="/" className="flex h-8 items-center px-2">
          <BrandLogo variant="logotype" className="h-6 w-auto" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
