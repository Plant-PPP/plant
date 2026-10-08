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
  ])("leaves %s", (_label, text) => {
    expect(scrubSensitiveText(text)).toBe(text);
  });

  it.each([
    ["encoded separators", "%25".repeat(5000) + "code="],
    ["letters", "a".repeat(16000)],
    ["dotted letters", "a.".repeat(8000)],
    ["digits before an at sign", "1".repeat(16000) + "@"],
    ["a long secret", "?code=" + "a".repeat(16000)],
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
  ])("masks %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "plant.holdings.count",
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
