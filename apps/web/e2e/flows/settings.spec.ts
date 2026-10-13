import { expect, type Page, test } from "@playwright/test";

import { signIn } from "./sign-in";

// Ajustes sits in the user's menu, under their address.
async function openSettings(page: Page, email: string) {
  await page.getByRole("button", { name: email }).click();
  await page.getByRole("menuitem", { name: "Ajustes" }).click();
  await expect(page).toHaveURL(/\/settings$/);
}

test("Ajustes exports the data as CSV", async ({ page }) => {
  await openSettings(page, await signIn(page));

  const card = page
    .locator("[data-slot=card]")
    .filter({ hasText: "Tus datos" });
  const download = page.waitForEvent("download");
  await card.getByRole("button").first().click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});

// The prototype deletes the data it holds; the user starts over as a new one.
test("deleting the account in Ajustes leaves a new user's Resumen", async ({
  page,
}) => {
  await openSettings(page, await signIn(page));

  await page.getByRole("button", { name: "Borrar mi cuenta" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Borrar tu cuenta?" });
  await dialog.getByRole("button", { name: "Borrar mi cuenta" }).click();

  await expect(
    page.getByText("Borramos tu cuenta y todo lo que tenía."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("link", { name: "Activos" }).click();
  await expect(page.getByRole("tab", { name: "Tenencias 0" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Cuentas 0" })).toBeVisible();
});
