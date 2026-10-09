import { nextAuthCode, sanitizeAuthCode } from "./sanitize-auth-code";

it("keeps only the code's digits", () => {
  expect(sanitizeAuthCode(" 12 34-56 ")).toBe("123456");
});

it("cuts a longer paste to the code's length", () => {
  expect(sanitizeAuthCode("1234567")).toBe("123456");
});

describe("nextAuthCode", () => {
  it("replaces a full field with a pasted code", () => {
    expect(nextAuthCode("111111", "111111222 222")).toBe("222222");
  });

  it("replaces a partial code with a pasted one", () => {
    expect(nextAuthCode("12", "12654321")).toBe("654321");
  });

  it("takes an autofilled code that replaced the value", () => {
    expect(nextAuthCode("123", "654321")).toBe("654321");
  });

  it("ignores a digit typed into a full field", () => {
    expect(nextAuthCode("123456", "1234567")).toBe("123456");
  });

  it("appends a typed digit", () => {
    expect(nextAuthCode("12", "123")).toBe("123");
  });

  it("keeps the digits left after a deletion", () => {
    expect(nextAuthCode("123", "12")).toBe("12");
  });

  it("finds the code inside pasted mail text", () => {
    expect(nextAuthCode("", "Tu código: 123456")).toBe("123456");
  });
});
