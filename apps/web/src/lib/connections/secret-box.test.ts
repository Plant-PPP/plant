import { randomBytes } from "node:crypto";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  open,
  seal,
  sealContext,
  SecretBoxError,
  secretsKey,
} from "./secret-box";

const KEY = randomBytes(32);
const CONTEXT = sealContext("user-a", "account-a", "binance");
const PLAIN = JSON.stringify({
  apiKey: "MadeUpKey0001",
  apiSecret: "MadeUp01",
});

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SecretBoxError);
    return (error as SecretBoxError).code;
  }
  throw new Error("expected a SecretBoxError");
};

describe("secret box", () => {
  it("opens what it sealed, and the sealed text carries none of it", () => {
    const sealed = seal(PLAIN, CONTEXT, KEY);
    expect(sealed).toMatch(
      /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/,
    );
    expect(sealed).not.toContain("MadeUp");
    expect(open(sealed, CONTEXT, KEY)).toBe(PLAIN);
  });

  it("seals the same text differently each time", () => {
    expect(seal(PLAIN, CONTEXT, KEY)).not.toBe(seal(PLAIN, CONTEXT, KEY));
  });

  it("does not open for another user, account or exchange", () => {
    const sealed = seal(PLAIN, CONTEXT, KEY);
    for (const context of [
      sealContext("user-b", "account-a", "binance"),
      sealContext("user-a", "account-b", "binance"),
      sealContext("user-a", "account-a", "other"),
    ]) {
      expect(code(() => open(sealed, context, KEY))).toBe("unopened");
    }
  });

  it("does not open under another key or once tampered with", () => {
    const sealed = seal(PLAIN, CONTEXT, KEY);
    expect(code(() => open(sealed, CONTEXT, randomBytes(32)))).toBe("unopened");
    const [version, iv, tag, body] = sealed.split(".");
    const flipped = `${body!.startsWith("A") ? "B" : "A"}${body!.slice(1)}`;
    expect(
      code(() => open([version, iv, tag, flipped].join("."), CONTEXT, KEY)),
    ).toBe("unopened");
  });

  it.each(["", "v2.a.b.c", "v1.a.b", "v1.short.short.body", "v1.a.b.c.d"])(
    "refuses %p as not sealed",
    (text) => {
      expect(code(() => open(text, CONTEXT, KEY))).toBe("malformed");
    },
  );

  it("takes a server key of 32 bytes only", () => {
    expect(secretsKey({})).toBeNull();
    expect(
      secretsKey({
        CONNECTION_SECRETS_KEY: randomBytes(16).toString("base64"),
      }),
    ).toBeNull();
    expect(
      secretsKey({ CONNECTION_SECRETS_KEY: KEY.toString("base64") })?.equals(
        KEY,
      ),
    ).toBe(true);
  });
});
