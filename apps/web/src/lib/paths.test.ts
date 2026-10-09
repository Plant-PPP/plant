import { isUnder } from "./paths";

it.each([
  ["/assets", "/assets"],
  ["/assets", "/assets/1"],
  ["/auth/mfa", "/auth/mfa/x"],
  ["/", "/"],
])("%s covers %s", (base, pathname) => {
  expect(isUnder(base, pathname)).toBe(true);
});

it.each([
  ["/assets", "/assetsx"],
  ["/assets", "/"],
  ["/auth/mfa", "/auth"],
  ["/", "/assets"],
])("%s does not cover %s", (base, pathname) => {
  expect(isUnder(base, pathname)).toBe(false);
});
