import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

// What the UI shows about the signed-in user. Built from the verified claims
// only.
export type SessionUser = { id: string; name: string; email: string };

export function toSessionUser(id: string, email: string): SessionUser {
  const local = email.split("@")[0];
  return { id, name: local || email, email };
}

export function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

// A tab still shows the user it was rendered for, so a sign-out elsewhere
// sends it to /login and a sign-in as someone else reloads it. auth-js also
// emits SIGNED_IN for the same session on every page load and tab focus, and
// broadcasts it to other tabs, so only a different user counts as a switch.
export function sessionChange(
  event: AuthChangeEvent,
  session: Session | null,
  shown: SessionUser,
): "signed-out" | "switched" | null {
  if (event === "SIGNED_OUT") return "signed-out";
  if (event === "SIGNED_IN" && session?.user.id !== shown.id) {
    return "switched";
  }
  return null;
}
