import { expect, test } from "@playwright/test";

import { signIn } from "./sign-in";

// The made-up user's terms are accepted already; the prototype's reading
// stands in for the model's, so no key is needed.
test("a file uploaded on Cargar is read, reviewed and confirmed", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Cargar" }).click();
  await expect(page).toHaveURL(/\/import$/);

  // A broker's statement goes into an account; the select starts at none.
  await page.getByRole("combobox", { name: "Cuenta" }).click();
  await page.getByRole("option").nth(1).click();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Elegir archivos" }).click();
  await (
    await chooser
  ).setFiles({
    name: "resumen-e2e.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Especie,Cantidad\nAAPL,10\n"),
  });

  const row = page.getByRole("row", { name: /resumen-e2e\.csv/ });
  await row.getByRole("link", { name: "Revisar" }).click();
  await expect(page).toHaveURL(/\/import\/[^/]+$/);

  await page.getByRole("button", { name: "Confirmar carga" }).click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(row).toContainText("Confirmada");
  await expect(row.getByRole("link", { name: "Revisar" })).toHaveCount(0);
});
