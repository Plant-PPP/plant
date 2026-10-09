import { mergeAuthCode } from "./merge-auth-code";

const mail = (code: string) =>
  `Escribí este código en la pantalla de ingreso: ${code} El código vence en 10 minutos.`;

describe("mergeAuthCode", () => {
  it("appends a typed digit", () => {
    expect(mergeAuthCode("12", "123")).toBe("123");
  });

  it("ignores a digit typed into a full field", () => {
    expect(mergeAuthCode("123456", "1234567")).toBe("123456");
  });

  it("ignores a typed letter", () => {
    expect(mergeAuthCode("12", "12a")).toBe("12");
  });

  it("keeps the digits left after a deletion", () => {
    expect(mergeAuthCode("123", "12")).toBe("12");
  });

  it("keeps only the digits of a pasted code", () => {
    expect(mergeAuthCode("", " 12 34-56 ")).toBe("123456");
  });

  it("appends a pasted part of a code", () => {
    expect(mergeAuthCode("12", "1234")).toBe("1234");
  });

  it("replaces a full field with a code pasted after it", () => {
    expect(mergeAuthCode("111111", "111111222-222")).toBe("222222");
  });

  it("replaces a partial code with a code pasted after it", () => {
    expect(mergeAuthCode("12", "12654321")).toBe("654321");
  });

  it("replaces a partial code that starts the pasted one", () => {
    expect(mergeAuthCode("12", "12123456")).toBe("123456");
  });

  it("takes the code from the whole mail pasted into an empty field", () => {
    expect(mergeAuthCode("", mail("654321"))).toBe("654321");
  });

  it("takes the code from the whole mail pasted after digits", () => {
    expect(mergeAuthCode("1", `1${mail("123456")}`)).toBe("123456");
  });

  it("takes one copy of a code pasted twice", () => {
    expect(mergeAuthCode("12", "12654321654321")).toBe("654321");
  });

  it("takes an autofilled code that replaced the value", () => {
    expect(mergeAuthCode("123", "654321", "insertReplacementText")).toBe(
      "654321",
    );
  });

  it("takes an autofill that starts with the digits already there", () => {
    expect(mergeAuthCode("123", "123456123456", "insertReplacementText")).toBe(
      "123456",
    );
  });

  it("only ever yields up to six digits", () => {
    for (const previous of ["", "12", "123456"]) {
      for (const raw of ["a1b2", "１２３", "12-34 56 78", "x".repeat(50)]) {
        expect(mergeAuthCode(previous, previous + raw)).toMatch(/^\d{0,6}$/);
      }
    }
  });
});
