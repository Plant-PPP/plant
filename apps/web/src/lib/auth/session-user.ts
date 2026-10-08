// What the UI shows about the signed-in user. Built from the verified email
// claim only.
export type SessionUser = { name: string; email: string };

export function toSessionUser(email: string): SessionUser {
  const local = email.split("@")[0];
  return { name: local || email, email };
}

export function initials(name: string): string {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
