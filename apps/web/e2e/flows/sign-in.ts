import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

// Local Mailpit ([local_smtp] in supabase/config.toml); E2E_MAILPIT_URL points
// the flows at another one.
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSearch = { messages: { Created: string; Snippet: string }[] };

// A new address per test: the first code signs it up, so every flow starts as
// a user of its own.
export function newEmail(): string {
  return `e2e-${randomUUID()}@e2e.test`;
}

// The code in the newest mail Mailpit caught for this address.
async function codeFor(page: Page, email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:"${email}"`, limit: 1 },
        });
        const { messages } = (await res.json()) as MailpitSearch;
        code = messages[0]?.Snippet.match(/\b(\d{6})\b/)?.[1];
        return code;
      },
      { message: `a sign-in code mailed to ${email}` },
    )
    .toBeDefined();
  return code!;
}

// Signs in through /login with the mailed code and waits for a data page. A
// page already on /login keeps its `next`.
export async function signIn(page: Page, email = newEmail()): Promise<string> {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.locator("next-route-announcer").waitFor({ state: "attached" });
  await page.getByRole("textbox", { name: "Mail" }).fill(email);
  await page.getByRole("button", { name: "Recibir código" }).click();
  await expect(
    page.getByText(`Te mandamos un código a ${email}`),
  ).toBeVisible();

  await page.getByLabel("Código").pressSequentially(await codeFor(page, email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("note")).toHaveText(
    "Datos de prueba. Lo que cambies se pierde al recargar.",
  );
  return email;
}
