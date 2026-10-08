// Masks credentials and personal data in text before it is logged. Every
// pattern is linear on hostile input: no nested quantifiers, one open-ended
// loop at most.

export const MASK = "<masked>";

// Auth's token names, as a query param and as a named value.
const AUTH_TOKEN =
  /token|token_hash|access_token|refresh_token|provider_token|provider_refresh_token|id_token/
    .source;

// Auth's single-use and bearer values. The separator, the `=` and the value's
// end are matched raw or percent-encoded once or twice, the forms a `next=`
// param carries. The value stops at `<`, so a masked value is not masked again.
const SECRET_PARAM = new RegExp(
  `((?:[?&#]|%(?:25)?(?:3F|26|23))(?:code|${AUTH_TOKEN})(?:=|%(?:25)?3D))(?:(?!%(?:25)?(?:26|23))[^&#\\s"'<>])+`,
  "gi",
);

// Credentials outside a query: a credential named in JSON or `name: value`
// form (a quoted value runs to its closing quote), a bearer value, a JWT
// (whole or cut), Supabase's auth cookie and secret keys. A letter before
// `Bearer` or `eyJ` means another word; a digit may be a mask's neighbour.
const NAMED_SECRET = new RegExp(
  `((?:${AUTH_TOKEN}|api[_-]?key|password|client_secret)"?\\s{0,8}[:=]\\s{0,8})("[^"]*|[^"\\s,}&<]+)`,
  "gi",
);
const BEARER = /((?<![A-Za-z])Bearer\s+)[^\s"',<]+/gi;
const JWT = /(?<![A-Za-z])eyJ[\w.-]{6,}/g;
const SUPABASE_AUTH_COOKIE = /(sb-[\w-]{1,64}-auth-token(?:\.\d+)?=)[^;\s"<]+/g;
const SUPABASE_SECRET_KEY = /sb_secret_[\w-]+/g;

// Not followed by `@`: a UUID used as an email's local part is not an id. A
// UUID inside a longer local part still splits it, and the part before it
// passes.
const UUID =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!@|%(?:25)?40)/i;

// Bounded by hex digits, not `\b`, so a number glued to `_` or a word, as in
// a file name, is masked, while digits inside a trace id or a hash are not. A
// DNI may follow a dot (`nro.12345678`) but not a digit and a dot.
const CBU = /(?<![\dA-Fa-f])\d{22}(?![\dA-Fa-f])/g;
const CUIT =
  /(?<![\dA-Fa-f])(?:20|23|24|27|30|33|34)[-. ]?\d{8}[-. ]?\d(?![\dA-Fa-f])/g;
const DNI = /(?<![\dA-Fa-f]|\d\.)\d{1,2}\.?\d{3}\.?\d{3}(?![\dA-Fa-f]|\.\d)/g;
// The lookbehind keeps the hex digits of a percent escape, raw or encoded
// (`%3Djohn%40…`, `%253Djohn%2540…`), out of the local part; an escape inside
// it, encoded once or twice, is a `+` or a byte of a non-ASCII letter. The
// domain needs a TLD, so `pkg@2.71.1` in a pnpm path is not an address.
const EMAIL =
  /(?<!%(?:25)?[0-9A-Fa-f]?)(?:[\p{L}\p{N}._+'-]|%(?:25)?2[Bb]|%(?:25)?[89A-Fa-f][0-9A-Fa-f]){1,64}(?:@|%40|%2540)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,24}(?!\p{L})/gu;

// Money and holdings: their ids pass.
const VALUE_SEGMENTS = new Set([
  "amount",
  "amounts",
  "balance",
  "balances",
  "quantity",
  "quantities",
  "price",
  "prices",
  "holding",
  "holdings",
  "worth",
  "debt",
  "debts",
]);

// Identity numbers, contacts and credentials: masked whatever the suffix.
const SECRET_SEGMENTS = new Set([
  "cuit",
  "cuil",
  "dni",
  "cbu",
  "cvu",
  "token",
  "tokens",
  "jwt",
  "password",
  "passwd",
  "secret",
  "credential",
  "credentials",
  "cookie",
  "cookies",
  "authorization",
  "apikey",
  "privatekey",
  "signingkey",
  "servicerole",
  "email",
  "phone",
]);

// Emails first: a mask is not hex, so a number after an address is masked in
// one pass.
function scrubPersonalData(text: string): string {
  return text
    .replace(EMAIL, MASK)
    .replace(CBU, MASK)
    .replace(CUIT, MASK)
    .replace(DNI, MASK);
}

export function scrubSensitiveText(text: string): string {
  // Secrets first: Auth's PKCE `code` is itself a UUID.
  const withoutSecrets = text
    .replace(SECRET_PARAM, `$1${MASK}`)
    .replace(
      NAMED_SECRET,
      (_match, name: string, value: string) =>
        `${name}${value.startsWith('"') ? '"' : ""}${MASK}`,
    )
    .replace(BEARER, `$1${MASK}`)
    .replace(SUPABASE_AUTH_COOKIE, `$1${MASK}`)
    .replace(JWT, MASK)
    .replace(SUPABASE_SECRET_KEY, MASK);
  // Odd parts are UUIDs (ids, not personal data) and are kept: their digit
  // groups would otherwise read as a DNI.
  return withoutSecrets
    .split(UUID)
    .map((part, index) => (index % 2 === 1 ? part : scrubPersonalData(part)))
    .join("");
}

// A field whose name says it holds money, holdings, an identity number, a
// contact or a credential. Counts and durations of those are not values and
// pass, and so do ids of money and holdings; their strings are still scrubbed.
export function isSensitiveKey(key: string): boolean {
  const segments = key
    .split(/[._-]|(?<=[a-z0-9])(?=[A-Z])/)
    .map((segment) => segment.toLowerCase());
  const last = segments.at(-1);
  if (
    last === "count" ||
    (segments.at(-2) === "duration" && last === "ms") ||
    (key.startsWith("gen_ai.") && last === "tokens")
  ) {
    return false;
  }
  // A pair of segments too, so `apiKey` and `api-key` read as `apikey`.
  const names = (set: Set<string>) =>
    segments.some(
      (segment, index) =>
        set.has(segment) || set.has(segment + (segments[index + 1] ?? "")),
    );
  return names(SECRET_SEGMENTS) || (last !== "id" && names(VALUE_SEGMENTS));
}
