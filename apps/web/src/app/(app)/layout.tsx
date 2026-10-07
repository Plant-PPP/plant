import { cookies } from "next/headers";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { AppSidebarHeader } from "@/components/layout/sidebar/app-sidebar-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-cookie";

// The app shell: inset sidebar on a tinted page background (--sidebar in
// globals.css), with the page canvas as a floating card.
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="h-svh min-h-0 overflow-hidden"
    >
      <AppSidebar />
      {/* A collapsed sidebar leaves no gutter of its own, so the Sidebar's DOM
          peer supplies the canvas's left margin. */}
      <div className="flex min-w-0 flex-1 md:peer-data-[state=collapsed]:ml-2">
        <SidebarInset>
          <AppSidebarHeader />
          <div className="flex flex-1 flex-col gap-4 p-4">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
