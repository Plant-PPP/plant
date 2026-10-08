import { MASK, isSensitiveKey, scrubSensitiveText } from "./credential-scrub";

const UUID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";

describe("scrubSensitiveText", () => {
  it.each([
    "code",
    "token",
    "token_hash",
    "access_token",
    "refresh_token",
    "provider_token",
    "provider_refresh_token",
    "id_token",
  ])("masks the %s param raw and inside an encoded next=", (name) => {
    expect(scrubSensitiveText(`/auth/callback?${name}=s3cr3t&next=/x`)).toBe(
      `/auth/callback?${name}=${MASK}&next=/x`,
    );
    expect(
      scrubSensitiveText(`/login?next=%2Fx%3F${name}%3Ds3cr3t%26a%3D1`),
    ).toBe(`/login?next=%2Fx%3F${name}%3D${MASK}%26a%3D1`);
    expect(
      scrubSensitiveText(`/login?next=%252Fx%253F${name}%253Ds3cr3t%2526a`),
    ).toBe(`/login?next=%252Fx%253F${name}%253D${MASK}%2526a`);
  });

  it("masks a code that is a UUID", () => {
    expect(scrubSensitiveText(`/auth/callback?code=${UUID}`)).toBe(
      `/auth/callback?code=${MASK}`,
    );
    expect(scrubSensitiveText(`/login?next=%2Fauth%3Fcode%3D${UUID}`)).toBe(
      `/login?next=%2Fauth%3Fcode%3D${MASK}`,
    );
  });

  it("masks a value in a fragment and up to whitespace", () => {
    expect(scrubSensitiveText("/x#access_token=abc.def&type=bearer")).toBe(
      `/x#access_token=${MASK}&type=bearer`,
    );
    expect(scrubSensitiveText("GET /x?token=abc failed")).toBe(
      `GET /x?token=${MASK} failed`,
    );
  });

  it.each([
    [
      "a token in JSON",
      '{"access_token":"abc","refresh_token": "def"}',
      `{"access_token":"${MASK}","refresh_token": "${MASK}"}`,
    ],
    ["a token after a colon", "access_token: abc", `access_token: ${MASK}`],
    ["a bare token in JSON", '{"token":"abc"}', `{"token":"${MASK}"}`],
    [
      "a quoted password with spaces",
      '{"password":"p@ss w0rd, x"}',
      `{"password":"${MASK}"}`,
    ],
    ["an API key header", "x-api-key: abc", `x-api-key: ${MASK}`],
    [
      "a JWT cut after its payload",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0",
      `jwt ${MASK}`,
    ],
    [
      "Supabase's auth cookie",
      "sb-abc-auth-token.1=eHl6MTIz; Path=/",
      `sb-abc-auth-token.1=${MASK}; Path=/`,
    ],
    ["a password param", "/x?a=1&password=hunter2", `/x?a=1&password=${MASK}`],
    ["an API key param", "/x?apikey=abc", `/x?apikey=${MASK}`],
    ["a bearer header", "Bearer abc.def", `Bearer ${MASK}`],
    [
      "a bare JWT",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc expired",
      `jwt ${MASK} expired`,
    ],
    ["a Supabase secret key", "key sb_secret_abc123", `key ${MASK}`],
  ])("masks %s", (_label, text, expected) => {
    expect(scrubSensitiveText(text)).toBe(expected);
  });

  it("leaves params that are not secrets", () => {
    const url =
      "/auth/callback?next=/assets&error=access_denied&error_code=otp_expired";
    expect(scrubSensitiveText(url)).toBe(url);
  });

  it("is idempotent", () => {
    for (const text of [
      "/login?next=%2Fx%3Fcode%3Dabc%26email%3Djohn%40x.com",
      "/auth/callback?code=abc&token_hash=def",
      "CUIT 20-12345678-9, DNI 12.345.678, ana@example.com",
      '{"access_token":"abc"} Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc',
      "12345678Bearer abc 12345678sb_secret_x 12345678eyJhbGciOiJ9",
      '{"password":"a b"} password=""',
    ]) {
      const once = scrubSensitiveText(text);
      expect(scrubSensitiveText(once)).toBe(once);
    }
  });

  it.each([
    ["a CBU", "CBU 0170099220000067797370", `CBU ${MASK}`],
    ["a CUIT with dashes", "CUIT 20-12345678-9", `CUIT ${MASK}`],
    ["a CUIT without dashes", "CUIT 27123456789", `CUIT ${MASK}`],
    ["a DNI with dots", "DNI 12.345.678", `DNI ${MASK}`],
    ["a DNI without dots", "DNI 12345678", `DNI ${MASK}`],
    ["a seven-digit DNI", "DNI 1234567", `DNI ${MASK}`],
    ["an email", "from ana.perez+x@example.com.ar", `from ${MASK}`],
    ["an encoded email", "email%3Dana%40example.com", `email%3D${MASK}`],
    [
      "a twice-encoded email",
      "email%253Dana%2540example.com",
      `email%253D${MASK}`,
    ],
    ["an email with an encoded plus", "ana%2Bx%40example.com", MASK],
    ["an email with a lowercase encoded plus", "ana%2bx@example.com", MASK],
    ["an email with accents", "from muñoz.josé@example.com", `from ${MASK}`],
    ["an email with an encoded accent", "/Jos%C3%A9@example.com", `/${MASK}`],
    ["an email with an apostrophe", "o'brien@example.com", MASK],
    ["an email glued to a word", "ana@example.com_x", `${MASK}_x`],
    [
      "a CUIT in a file name",
      "Resumen_20123456789_202409.pdf",
      `Resumen_${MASK}_202409.pdf`,
    ],
    [
      "a CBU in a file name",
      "extracto_0170099220000067797370.pdf",
      `extracto_${MASK}.pdf`,
    ],
    ["a DNI in a file name", "dni_12345678.jpg", `dni_${MASK}.jpg`],
    ["a CUIT glued to a word", "CUIT20123456789", `CUIT${MASK}`],
    ["a CUIT with dots", "CUIT 20.12345678.9", `CUIT ${MASK}`],
    ["a DNI after an abbreviation", "DNI nro.12345678", `DNI nro.${MASK}`],
    ["a dotted file name", "dni.12345678.jpg", `dni.${MASK}.jpg`],
    [
      "a twice-encoded email with an accent",
      "jos%25C3%25A9%2540example.com",
      MASK,
    ],
    ["a twice-encoded email with a plus", "ana%252Bx%2540example.com", MASK],
  ])("masks %s", (_label, text, expected) => {
    expect(scrubSensitiveText(text)).toBe(expected);
  });

  it("keeps UUIDs alone and in a path", () => {
    expect(scrubSensitiveText(UUID)).toBe(UUID);
    expect(scrubSensitiveText(`/x/${UUID}/y`)).toBe(`/x/${UUID}/y`);
    expect(scrubSensitiveText("12345678-1234-4234-8234-123456789012")).toBe(
      "12345678-1234-4234-8234-123456789012",
    );
  });

  it("masks a UUID used as an email's local part", () => {
    expect(scrubSensitiveText(`${UUID}@example.com`)).not.toMatch(
      /example|dddd/,
    );
  });

  it("still masks personal data next to a UUID", () => {
    expect(scrubSensitiveText(`${UUID} DNI 12345678`)).toBe(
      `${UUID} DNI ${MASK}`,
    );
  });

  it.each([
    ["a six-digit number", "code 123456 sent"],
    ["an ISO date", "on 2026-10-08T16:00:00Z"],
    ["an epoch", "at 1791475200000"],
    ["a pnpm path", "node_modules/.pnpm/@supabase+auth-js@2.71.1/node_modules"],
    ["a trace id", "trace 0af7651916cd43dd8448eb211c80319c"],
    ["a commit SHA", "sha 3f2a12345678bc9d0e1f2a3b4c5d6e7f80912345"],
    ["a chunk name", "/_next/static/chunks/2017-87654321abcdef.js:1:2345"],
    ["a word with eyJ inside", "keyJsonParser failed"],
  ])("leaves %s", (_label, text) => {
    expect(scrubSensitiveText(text)).toBe(text);
  });

  it.each([
    ["encoded separators", "%25".repeat(5000) + "code="],
    ["letters", "a".repeat(16000)],
    ["dotted letters", "a.".repeat(8000)],
    ["digits before an at sign", "1".repeat(16000) + "@"],
    ["a long secret", "?code=" + "a".repeat(16000)],
    [
      "long local parts and domains",
      ("/" + "a".repeat(64) + "@" + ("b".repeat(63) + ".").repeat(9) + "1")
        .repeat(7)
        .slice(0, 4096),
    ],
    ["a long JWT prefix", "eyJ" + "a".repeat(16000)],
    ["repeated JWT prefixes", "eyJ-".repeat(4000)],
    ["repeated named secrets", 'password:"'.repeat(1600)],
  ])("stays fast on %s", (_label, text) => {
    scrubSensitiveText(text);
    const runs = [0, 1, 2].map(() => {
      const start = performance.now();
      scrubSensitiveText(text);
      return performance.now() - start;
    });
    expect(Math.min(...runs)).toBeLessThan(50);
  });
});

describe("isSensitiveKey", () => {
  it.each([
    "cuit",
    "holding.amount",
    "holdingAmount",
    "plant.holding-amount",
    "http.response.header.set-cookie",
    "price.discount",
    "apiKey",
    "x-api-key",
    "user.email",
    "plant.token_count_x",
    "amounts",
    "privateKey",
    "service_role_key",
    "plant.auth.jwt",
    "user.phone",
    "cuit_id",
    "token.id",
    "emailId",
  ])("masks %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "plant.holdings.count",
    "plant.holding.id",
    "plant.debt.id",
    "gen_ai.usage.input_tokens",
    "plant.price.duration_ms",
    "plant.auth.duration_ms",
    "plant.auth.error_code",
    "enduser.id",
    "error.type",
    "plant.request_id",
  ])("passes %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});
