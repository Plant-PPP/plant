// Masks credentials and personal data in text before it is logged. Every
// pattern is linear on hostile input: no nested quantifiers, one open-ended
// loop at most.

export const MASK = "<masked>";

// Auth's single-use and bearer values. The separator, the `=` and the value's
// end are matched raw or percent-encoded once or twice, the forms a `next=`
// param carries. The value stops at `<`, so a masked value is not masked again.
const SECRET_PARAM =
  /((?:[?&#]|%(?:25)?(?:3F|26|23))(?:code|token|token_hash|access_token|refresh_token|provider_token|provider_refresh_token|id_token)(?:=|%(?:25)?3D))(?:(?!%(?:25)?(?:26|23))[^&#\s"'<>])+/gi;

// Credentials outside a query: a JWT, a bearer header, Supabase's secret keys
// and a credential named in JSON or `name: value` form.
const JWT = /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*/g;
const BEARER = /\b(Bearer\s+)[^\s"',<]+/gi;
const SUPABASE_SECRET_KEY = /\bsb_secret_[\w-]+/g;
const NAMED_SECRET =
  /((?:access_token|refresh_token|provider_token|provider_refresh_token|id_token|token_hash|api_?key|password)"?\s{0,8}[:=]\s{0,8}"?)[^"\s,}&<]+/gi;

// Not followed by `@`: a UUID used as an email's local part is not an id.
const UUID =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?!@|%(?:25)?40)/i;

// Bounded by digits, not `\b`, so a number glued to `_` or a letter, as in a
// file name, is still masked.
const CBU = /(?<!\d)\d{22}(?!\d)/g;
const CUIT = /(?<!\d)(?:20|23|24|27|30|33|34)-?\d{8}-?\d(?!\d)/g;
const DNI = /(?<![\d.])\d{1,2}\.?\d{3}\.?\d{3}(?![\d.]?\d)/g;
// The lookbehind keeps the hex digits of a percent escape, raw or encoded
// (`%3Djohn%40…`, `%253Djohn%2540…`), out of the local part; an escape inside
// it is a `+` or a byte of a non-ASCII letter. The domain needs a TLD, so
// `pkg@2.71.1` in a pnpm path is not an address.
const EMAIL =
  /(?<!%(?:25)?[0-9A-Fa-f]?)(?:[\p{L}\p{N}._+'-]|%2[Bb]|%[89A-Fa-f][0-9A-Fa-f]){1,64}(?:@|%40|%2540)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,24}(?!\p{L})/gu;

const SENSITIVE_SEGMENTS = new Set([
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

function scrubPersonalData(text: string): string {
  return text
    .replace(CBU, MASK)
    .replace(CUIT, MASK)
    .replace(DNI, MASK)
    .replace(EMAIL, MASK);
}

export function scrubSensitiveText(text: string): string {
  // Secrets first: Auth's PKCE `code` is itself a UUID.
  const withoutSecrets = text
    .replace(SECRET_PARAM, `$1${MASK}`)
    .replace(NAMED_SECRET, `$1${MASK}`)
    .replace(BEARER, `$1${MASK}`)
    .replace(JWT, MASK)
    .replace(SUPABASE_SECRET_KEY, MASK);
  // Odd parts are UUIDs (ids, not personal data) and are kept: their digit
  // groups would otherwise read as a DNI.
  return withoutSecrets
    .split(UUID)
    .map((part, index) => (index % 2 === 1 ? part : scrubPersonalData(part)))
    .join("");
}

// A field whose name says it holds money, holdings, an identity number or a
// credential. Ids, counts and durations of those are not values and pass;
// their strings are still scrubbed.
export function isSensitiveKey(key: string): boolean {
  const segments = key
    .split(/[._-]|(?<=[a-z0-9])(?=[A-Z])/)
    .map((segment) => segment.toLowerCase());
  const last = segments.at(-1);
  const isNotValue =
    last === "id" ||
    last === "count" ||
    (segments.at(-2) === "duration" && last === "ms") ||
    (key.startsWith("gen_ai.") && last === "tokens");
  // A pair of segments too, so `apiKey` and `api-key` read as `apikey`.
  return (
    !isNotValue &&
    segments.some(
      (segment, index) =>
        SENSITIVE_SEGMENTS.has(segment) ||
        SENSITIVE_SEGMENTS.has(segment + (segments[index + 1] ?? "")),
    )
  );
}
