import { cookies } from "next/headers";
import { PageCrumbsProvider } from "@/components/layout/page-crumbs";
import { InstitutionIconsProvider } from "@/components/portfolio-setup/institution-icons";
import { QueryProvider } from "@/components/query-provider";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { AppSidebarHeader } from "@/components/layout/sidebar/app-sidebar-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { toSessionUser } from "@/lib/auth/session-user";
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-cookie";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const claims = await getSessionClaims();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";
  // The icons of the user's own institutions, for every screen that names an
  // account; a failed read leaves the initials.
  const icons = await (
    await createClient()
  )
    .from("source_connections")
    .select("institution, icon")
    .not("icon", "is", null);

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="h-svh min-h-0 overflow-hidden"
    >
      <AppSidebar user={toSessionUser(claims.sub, claims.email ?? "")} />
      {/* A collapsed sidebar leaves no gutter of its own, so the Sidebar's DOM
          peer supplies the canvas's left margin. */}
      <div className="flex min-w-0 flex-1 md:peer-data-[state=collapsed]:ml-2">
        <SidebarInset>
          <PageCrumbsProvider>
            <AppSidebarHeader />
            <div className="flex flex-1 flex-col gap-4 p-4">
              <QueryProvider>
                <InstitutionIconsProvider
                  icons={(icons.data ?? []).flatMap((each) =>
                    each.icon
                      ? [{ institution: each.institution, icon: each.icon }]
                      : [],
                  )}
                >
                  {children}
                </InstitutionIconsProvider>
              </QueryProvider>
            </div>
          </PageCrumbsProvider>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
