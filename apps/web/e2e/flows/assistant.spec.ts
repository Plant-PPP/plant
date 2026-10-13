import { expect, test } from "@playwright/test";

import { signIn } from "./sign-in";

// The prototype answers from the made-up data, standing in for the model.
test("a suggested question gets an answer with its date and its chart", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Asistente" }).click();
  await expect(page).toHaveURL(/\/assistant$/);

  await page
    .getByRole("button", { name: "¿Cómo evolucionó mi patrimonio?" })
    .click();

  const conversation = page.getByRole("region", { name: "Conversación" });
  await expect(conversation).toContainText("¿Cómo evolucionó mi patrimonio?");
  await expect(conversation).toContainText("Tu patrimonio pasó de");
  await expect(conversation).toContainText(/Calculado el \d{2}\/\d{2}\/\d{4}/);
  const chart = conversation
    .getByRole("figure")
    .filter({ hasText: "Tu patrimonio, mes a mes" });
  await expect(chart.getByRole("listitem").first()).toContainText("US$ ");
  await expect(page.getByText("no es asesoramiento financiero")).toBeVisible();
});
