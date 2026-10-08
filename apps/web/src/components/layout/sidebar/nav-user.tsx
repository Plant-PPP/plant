"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { LOGIN_PATH, loginPath } from "@/lib/auth/routes";
import { initials, type SessionUser } from "@/lib/auth/session-user";
import { createClient } from "@/lib/supabase/client";

function UserSummary({ user }: { user: SessionUser }) {
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-xs font-medium">
        {initials(user.name)}
      </span>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {user.email}
        </span>
      </span>
    </>
  );
}

export function NavUser({ user }: { user: SessionUser }) {
  const { isMobile } = useSidebar();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  // This tab's own sign-out also fires SIGNED_OUT; it goes to /login without
  // a `next`.
  const signingOut = useRef(false);

  // Another tab signed out, or Auth ended the session.
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !signingOut.current) {
        window.location.assign(
          loginPath(window.location.pathname + window.location.search),
        );
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signOut() {
    signingOut.current = true;
    setPending(true);
    setFailed(false);
    const { error } = await createClient().auth.signOut({ scope: "local" });
    if (error) {
      signingOut.current = false;
      setPending(false);
      setFailed(true);
      return;
    }
    window.location.assign(LOGIN_PATH);
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={() => setFailed(false)}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserSummary user={user} />
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="flex items-center gap-2 font-normal">
              <UserSummary user={user} />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={pending}
              onSelect={(event) => {
                event.preventDefault();
                void signOut();
              }}
            >
              <LogOut />
              Cerrar sesión
            </DropdownMenuItem>
            {failed && (
              <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
                No pudimos cerrar la sesión. Probá de nuevo.
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
