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
    expect(mergeAuthCode("123", "654321", true)).toBe("654321");
  });

  it("takes an autofill that starts with the digits already there", () => {
    expect(mergeAuthCode("123", "123456123456", true)).toBe("123456");
  });

  it("takes the code, not the date of a mail copied with its header", () => {
    expect(mergeAuthCode("", `9 oct 2026 10:15\n${mail("654321")}`)).toBe(
      "654321",
    );
  });

  it("appends the end of a code pasted with the mail's next line", () => {
    expect(mergeAuthCode("12", "123456 El código vence en 10 minutos.")).toBe(
      "123456",
    );
  });

  it("deletes the last digit of a full field", () => {
    expect(mergeAuthCode("123456", "12345")).toBe("12345");
  });

  it("clears the field on a word delete", () => {
    expect(mergeAuthCode("1234", "")).toBe("");
  });

  it("ignores a partial paste into a full field", () => {
    expect(mergeAuthCode("123456", "12345678")).toBe("123456");
  });

  it.each([
    "123 456",
    "123\u00a0456",
    "123  456",
    "123 - 456",
    "123\t456",
    "123.456",
    "123\u2013456",
  ])("keeps a code split by separators (%j)", (raw) => {
    expect(mergeAuthCode("", raw)).toBe("123456");
  });

  it("takes a split code, not the date before it", () => {
    expect(mergeAuthCode("", "9 oct 2026 10:15 Código 654 321")).toBe("654321");
  });

  it("skips the digits of a mail address", () => {
    expect(mergeAuthCode("", "Para: juan123456@x.com\n654321")).toBe("654321");
  });

  it("lets a whole code win over any digits already there", () => {
    for (const previous of ["", "1", "12345", "111111"]) {
      expect(mergeAuthCode(previous, `${previous}654321`)).toBe("654321");
      expect(mergeAuthCode(previous, `${previous}654 321`)).toBe("654321");
      expect(mergeAuthCode(previous, "654321", true)).toBe("654321");
    }
  });

  it.each(["123/456", "123_456", "123,456", "123\u2212456"])(
    "keeps a code split by other marks (%j)",
    (raw) => {
      expect(mergeAuthCode("", raw)).toBe("123456");
    },
  );

  it("does not take a code from inside a longer number", () => {
    expect(mergeAuthCode("", "DNI 12.345.678\n654 321")).toBe("654321");
    expect(mergeAuthCode("", "123 456 789\n654321")).toBe("654321");
  });

  it("types and deletes one digit at a time", () => {
    let code = "";
    for (const digit of "654321") code = mergeAuthCode(code, code + digit);
    expect(code).toBe("654321");
    while (code) code = mergeAuthCode(code, code.slice(0, -1));
    expect(code).toBe("");
  });

  it("never yields more than six ASCII digits for random text", () => {
    let seed = 1;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const alphabet = "0123456789 -.\u2013 @a\uff11\n";
    for (let k = 0; k < 2000; k++) {
      const previous = "123456".slice(0, Math.floor(random() * 7));
      const text = Array.from(
        { length: Math.floor(random() * 40) },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join("");
      for (const all of [false, true]) {
        expect(mergeAuthCode(previous, previous + text, all)).toMatch(
          /^\d{0,6}$/,
        );
      }
    }
  });

  it.each([false, true])("only ever yields up to six digits (%s)", (all) => {
    for (const previous of ["", "12", "123456"]) {
      for (const raw of ["a1b2", "１２３", "98-76 54 32 10", "x".repeat(50)]) {
        for (const text of [raw, previous + raw]) {
          expect(mergeAuthCode(previous, text, all)).toMatch(/^\d{0,6}$/);
        }
      }
    }
  });
});
