import { expect, test } from "@playwright/test";

import { signIn } from "./sign-in";

test("a holding added by hand shows in Activos", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Activos", exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);

  await page.getByRole("button", { name: "Agregar tenencia" }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar tenencia" });
  await dialog.getByRole("combobox", { name: "Tipo" }).click();
  await page.getByRole("option", { name: "Efectivo" }).click();
  await dialog.getByRole("combobox", { name: "Cuenta" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("combobox", { name: "Moneda" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("textbox", { name: "Monto" }).fill("1234,5");
  await dialog.getByRole("button", { name: "Nombre" }).click();
  await dialog.getByRole("textbox", { name: "Nombre" }).fill("Caja de prueba");
  await dialog.getByRole("button", { name: "Agregar" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: /Caja de prueba/ })).toContainText(
    "1.234,50",
  );
});
