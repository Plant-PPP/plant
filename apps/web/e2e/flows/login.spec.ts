import { expect, test } from "@playwright/test";

import { signIn } from "./sign-in";

test("a new address signs in with the mailed code and goes where it was headed", async ({
  page,
}) => {
  await page.goto("/assets");
  await expect(page).toHaveURL(/\/login\?next=%2Fassets$/);

  const email = await signIn(page);
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByText(email)).toBeVisible();
});
