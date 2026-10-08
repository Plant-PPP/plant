// The Supabase secret key bypasses RLS. Shared by the web app and the
// packages, which Next compiles into the same server: only
// apps/web/src/lib/supabase/service-role.ts (and its test) may name it.
const SECRET_KEY = "/^(NEXT_PUBLIC_)?SUPABASE_SERVICE_ROLE_KEY$/";

export const secretKeyReads = [
  `Identifier[name=${SECRET_KEY}]`,
  `Literal[value=${SECRET_KEY}]`,
  `TemplateElement[value.cooked=${SECRET_KEY}]`,
].map((selector) => ({
  selector,
  message:
    "Only apps/web/src/lib/supabase/service-role.ts reads the secret key.",
}));
