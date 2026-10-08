import { sanitizeAuthCode } from "./sanitize-auth-code";

it("keeps only the code's digits", () => {
  expect(sanitizeAuthCode(" 12 34-56 ")).toBe("123456");
});

it("cuts a longer paste to the code's length", () => {
  expect(sanitizeAuthCode("1234567")).toBe("123456");
});
