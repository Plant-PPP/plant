import { nextAuthCode } from "./next-auth-code";

it("keeps only the code's digits", () => {
  expect(nextAuthCode("", " 12 34-56 ")).toBe("123456");
});

it("cuts a longer paste to the code's length", () => {
  expect(nextAuthCode("", "1234567")).toBe("123456");
});

it("only ever yields up to six digits", () => {
  for (const previous of ["", "12", "123456"]) {
    for (const raw of ["a1b2", "１２３", "12-34 56 78", "x".repeat(50)]) {
      expect(nextAuthCode(previous, previous + raw)).toMatch(/^\d{0,6}$/);
    }
  }
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

  it("replaces a full field with a dashed code pasted after it", () => {
    expect(nextAuthCode("111111", "111111222-222")).toBe("222222");
  });

  it("ignores a typed letter", () => {
    expect(nextAuthCode("12", "12a")).toBe("12");
  });

  it("appends a typed digit", () => {
    expect(nextAuthCode("12", "123")).toBe("123");
  });

  it("keeps the digits left after a deletion", () => {
    expect(nextAuthCode("123", "12")).toBe("12");
  });

  it("takes one copy of a code autofilled twice", () => {
    expect(nextAuthCode("", "123456123456")).toBe("123456");
  });

  it("replaces a selected full field with a typed digit", () => {
    expect(nextAuthCode("123456", "7")).toBe("7");
  });

  it("finds the code inside pasted mail text", () => {
    expect(nextAuthCode("", "Tu código: 123456")).toBe("123456");
  });
});
