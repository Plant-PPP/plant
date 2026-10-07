import { NavMain } from "@/components/layout/sidebar/nav-main";
import { NavSecondary } from "@/components/layout/sidebar/nav-secondary";
import { SidebarHomeLink } from "@/components/layout/sidebar/sidebar-home-link";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader>
        <SidebarHomeLink />
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
