import { expectLinear } from "@/test/expect-linear";
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

  it.each([
    [
      "a single-quoted value with an escaped quote",
      "password: 'it\\'s me' ok",
      `password: '${MASK}' ok`,
    ],
    [
      "a backticked value",
      'password: `he said "it\'s" ok`, x',
      `password: \`${MASK}\`, x`,
    ],
    [
      "an escaped single-quoted value",
      "password: \\'hunter2\\' ok",
      `password: \\'${MASK}\\' ok`,
    ],
    ["a secret key", "secret_key=abc123 ok", `secret_key=${MASK} ok`],
    [
      "a signing key",
      '{"signingKey":"abc123"} INNGEST_SIGNING_KEY=signkey-prod-0123abcdef',
      `{"signingKey":"${MASK}"} INNGEST_SIGNING_KEY=${MASK}`,
    ],
    ["an unnamed Inngest key", "bad signkey-test-0123abcdef", `bad ${MASK}`],
    ["a private key", "privateKey: abc123 ok", `privateKey: ${MASK} ok`],
    [
      "a PKCE code named in camel case",
      `{"authCode":"${UUID}"}`,
      `{"authCode":"${MASK}"}`,
    ],
  ])("masks %s whole", (_label, text, expected) => {
    expect(scrubSensitiveText(text)).toBe(expected);
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
      "a password in escaped JSON",
      String.raw`body: "{\"password\":\"hunter2\"}"`,
      String.raw`body: "{\"password\":\"${MASK}\"}"`,
    ],
    [
      "a quoted password with an escaped quote",
      String.raw`{"password":"he said \"hi\" ok"}`,
      `{"password":"${MASK}"}`,
    ],
    [
      "a single-quoted password",
      "{ password: 'correct horse, battery' }",
      `{ password: '${MASK}' }`,
    ],
    ["a secret", "secret: abc", `secret: ${MASK}`],
    [
      "a basic header",
      "Authorization: Basic YWxhZGRpbg==",
      `Authorization: Basic ${MASK}`,
    ],
    ["the PKCE code in JSON", `{"code":"${UUID}"}`, `{"code":"${MASK}"}`],
    [
      "the PKCE verifier cookie",
      "sb-abc-auth-token-code-verifier=base64-IjNmYTJi; Path=/",
      `sb-abc-auth-token-code-verifier=${MASK}; Path=/`,
    ],
    [
      "Auth's refresh token message, keeping its shape",
      "Invalid Refresh Token: Already Used",
      `Invalid Refresh Token: ${MASK} Used`,
    ],
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
      String.raw`{\"password\":\"x\"} password: 'y' {"code":"${UUID}"}`,
      "token:'=aa'x@y.com;",
      "v 2012.345.678deadbeefcafebabe20123456789",
      "x 1.234.567.890abcdefabcdefa20123456789",
      `T1code:${UUID}code:${UUID}`,
      "?code=%2312345 ?code=%2612345x ?code=%2523123x",
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
    [
      "a CUIT after a word ending in a hex letter",
      "Comprobante20123456789.pdf",
      `Comprobante${MASK}.pdf`,
    ],
    ["a DNI before a word", "12345678frente.jpg", `${MASK}frente.jpg`],
    ["a DNI after a word", "unidad12345678", `unidad${MASK}`],
    ["a CBU after a word", "cuenta0170099220000067797370", `cuenta${MASK}`],
    ["a CUIT with dots", "CUIT 20.12345678.9", `CUIT ${MASK}`],
    ["a DNI after an abbreviation", "DNI nro.12345678", `DNI nro.${MASK}`],
    ["a dotted file name", "dni.12345678.jpg", `dni.${MASK}.jpg`],
    [
      "a twice-encoded email with an accent",
      "jos%25C3%25A9%2540example.com",
      MASK,
    ],
    ["a twice-encoded email with a plus", "ana%252Bx%2540example.com", MASK],
    [
      "a DNI after an encoded space",
      "/files/DNI%2012345678.pdf",
      `/files/DNI%20${MASK}.pdf`,
    ],
    [
      "a CUIT after an encoded space",
      "/files/CUIT%2020123456789.pdf",
      `/files/CUIT%20${MASK}.pdf`,
    ],
    [
      "a CBU after an encoded space",
      "/files/CBU%200170099220000067797370.pdf",
      `/files/CBU%20${MASK}.pdf`,
    ],
    [
      "a CBU after an encoded slash",
      "/x%2F0170099220000067797370",
      `/x%2F${MASK}`,
    ],
    [
      "a DNI after a twice-encoded space",
      "/DNI%252012345678",
      `/DNI%2520${MASK}`,
    ],
    ["a DNI in an encoded JSON string", "%2212345678%22", `%22${MASK}%22`],
    [
      "a CBU after a hex letter",
      "cbu_de0170099220000067797370.pdf",
      `cbu_de${MASK}.pdf`,
    ],
    [
      "a DNI after a comma time",
      "at 16:00:00,12345678,ana",
      `at 16:00:00,${MASK},ana`,
    ],
    ["a DNI after a CUIT and a dot", "20123456789.12345678", `${MASK}.${MASK}`],
    [
      "two DNIs joined by a dot",
      "dni_12345678.87654321.pdf",
      `dni_${MASK}.pdf`,
    ],
    ["a password named passwd", "passwd=hunter2 ok", `passwd=${MASK} ok`],
    [
      "a dotted DNI after a comma time",
      "16:00:00,12.345.678,ana",
      `16:00:00,${MASK},ana`,
    ],
    [
      "a DNI after an encoded accent and a dot",
      "/tmp/uploads/Jos%C3%A9.12345678.pdf",
      `/tmp/uploads/Jos%C3%A9.${MASK}.pdf`,
    ],
    [
      "two dotted DNIs after a percent escape",
      "/files/DNI%2012345678.87654321.pdf /DNI%252012345678.87654321",
      `/files/DNI%20${MASK}.pdf /DNI%2520${MASK}`,
    ],
    [
      "a CUIT with a spreadsheet's thousands dots",
      "Fila 3;Perez Juan;20.123.456.789;AL30",
      `Fila 3;Perez Juan;${MASK};AL30`,
    ],
    [
      "a zero-padded DNI",
      "Doc: 012345678, nro 0012345678",
      `Doc: ${MASK}, nro ${MASK}`,
    ],
    [
      "two dotted DNIs after an encoded accent or quote",
      "Jos%C3%A9.12345678.87654321.pdf %2212345678.87654321%22",
      `Jos%C3%A9.${MASK}.pdf %22${MASK}%22`,
    ],
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

  it("keeps an Inngest run id whose digits read as a DNI", () => {
    const runId = "01M8Z3K4567890QWERTYXABCDE";
    expect(scrubSensitiveText(runId)).toBe(runId);
    expect(scrubSensitiveText(`run ${runId} DNI 12345678`)).toBe(
      `run ${runId} DNI ${MASK}`,
    );
  });

  it.each([
    ["25 characters", "01M8Z3K45678901QWERTYXABC"],
    ["27 characters", "01M8Z3K45678901QWERTYXABCDE"],
  ])("masks the DNI in a run-id-like token of %s", (_label, token) => {
    expect(scrubSensitiveText(token)).toContain(MASK);
  });

  it.each([
    ["a CBU and 4 letters", "0170099220000067797370ABCD"],
    ["a CUIT and 15 letters", "20123456789ABCDEFGHJKMNPQR"],
    ["a DNI and 18 letters", "12345678abcdefghjkmnpqrstv"],
  ])("masks %s in a run-id-shaped token", (_label, token) => {
    expect(scrubSensitiveText(token)).toContain(MASK);
  });

  // A run id's first character is always a digit, so a digit run after it is
  // not "another" digit run that makes the token an id.
  it.each([
    ["a DNI", "1X12345678ABCDEFGHJKMNPQRS"],
    ["a CUIT", "2X20123456789ABCDEFGHJKMNP"],
    ["a CBU", "0X0170099220000067797370AB"],
  ])(
    "masks %s after the first character of a run-id-shaped token",
    (_label, token) => {
      expect(scrubSensitiveText(token)).toContain(MASK);
    },
  );

  // A ULID's first character is 0 to 7 (its 48-bit time; the rule keeps only
  // 0, until 3084), so a token that starts any other way is no run id, even
  // with a second digit run.
  it.each([
    ["a letter", "ABCDEFGHJK12345678MNPQRS9T"],
    ["an 8", "8BCDEFGHJK12345678MNPQRS9T"],
  ])("masks a DNI in a token that starts with %s", (_label, token) => {
    expect(scrubSensitiveText(token)).toContain(MASK);
  });

  // A run id's third character is a letter until 2039, so the digit run it
  // opens with is at most two digits.
  it.each([
    ["a zero-padded DNI", "09123456ABCDEFGHJKMNPQRSTV"],
    ["a zero-padded DNI in lower case", "01234567abcdefghjkmnpqrstv"],
  ])("masks %s that opens a run-id-shaped token", (_label, token) => {
    expect(scrubSensitiveText(token)).toContain(MASK);
  });

  // Pin of current behavior: a run of 26 digits is no id and no number the
  // patterns know.
  it("leaves a 26-digit run as it is", () => {
    const digits = "12345678901234567890123456";
    expect(scrubSensitiveText(digits)).toBe(digits);
  });

  it("still masks personal data next to a UUID", () => {
    expect(scrubSensitiveText(`${UUID} DNI 12345678`)).toBe(
      `${UUID} DNI ${MASK}`,
    );
  });

  it.each([
    ["a six-digit number", "code 123456 sent"],
    ["a Postgres error code", '{"code":"23502","message":"null value"}'],
    ["an ISO date", "on 2026-10-08T16:00:00Z"],
    ["an epoch", "at 1791475200000"],
    ["a pnpm path", "node_modules/.pnpm/@supabase+auth-js@2.71.1/node_modules"],
    ["a trace id", "trace 0af7651916cd43dd8448eb211c80319c"],
    ["a commit SHA", "sha 3f2a12345678bc9d0e1f2a3b4c5d6e7f80912345"],
    ["a chunk name", "/_next/static/chunks/page-4f3a87654321bc9d.js:1:2345"],
    ["a timestamp with microseconds", "at 2026-10-08T16:00:00.123456+00:00"],
    ["a basic ISO timestamp", "X-Amz-Date=20261008T160000Z"],
    ["a basic ISO timestamp with a fraction", "at 20261008T160000.123Z"],
    ["a dotted version", "Next.js 15.5.4 and 1.234.567.890"],
    ["a comma time with microseconds", "at 16:00:00,123456 done"],
    [
      "a hex id after an encoded slash",
      "/x%2F0af7651916cd43dd8448eb211c80319c",
    ],
    [
      "a trace id with 11 digits in a row",
      "id 8533594127572b4035953ecf07800e41 x",
    ],
    ["a span id that holds a CUIT's digits", "id e23190104525f268 x"],
    ["a word with eyJ inside", "keyJsonParser failed"],
    [
      "a short number after a percent escape",
      "/import/Factura%20123456.pdf /import/Resumen%20%2812345%29.pdf %22123456789%22",
    ],
  ])("leaves %s", (_label, text) => {
    expect(scrubSensitiveText(text)).toBe(text);
  });

  it.each<[string, (scale: number) => string]>([
    ["encoded separators", (k) => "%25".repeat(5000 * k) + "code="],
    ["letters", (k) => "a".repeat(16000 * k)],
    ["dotted letters", (k) => "a.".repeat(8000 * k)],
    ["digits before an at sign", (k) => "1".repeat(16000 * k) + "@"],
    ["a long secret", (k) => "?code=" + "a".repeat(16000 * k)],
    [
      "long local parts and domains",
      (k) =>
        ("/" + "a".repeat(64) + "@" + ("b".repeat(63) + ".").repeat(9) + "1")
          .repeat(7 * k)
          .slice(0, 4096 * k),
    ],
    ["a long JWT prefix", (k) => "eyJ" + "a".repeat(16000 * k)],
    ["repeated JWT prefixes", (k) => "eyJ-".repeat(4000 * k)],
    ["repeated named secrets", (k) => 'password:"'.repeat(1600 * k)],
    ["run-id openings", (k) => "-0a".repeat(5000 * k)],
    ["a run-id opening before letters", (k) => "0a" + "b".repeat(16000 * k)],
    [
      "run-id openings after percent escapes",
      (k) => "%410ab1234567".repeat(1200 * k),
    ],
    [
      "run-id openings before digits",
      (k) => ("-01" + "2".repeat(30)).repeat(500 * k),
    ],
  ])("stays linear on %s", (_label, input) => {
    expectLinear(input, scrubSensitiveText);
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
    "plant.code_verifier",
    "plant.auth.otp",
    "plant.auth.code",
    "authCode",
    "inngest.event_key",
    "eventKey",
  ])("masks %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "plant.holdings.count",
    "plant.holding.id",
    "plant.debt.id",
    "plant.holding.ids",
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
