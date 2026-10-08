// Masks credentials and personal data in text before it is logged. Every
// pattern is linear on hostile input: no nested quantifiers, bounded repeats.

export const MASK = "<masked>";

// Auth's single-use and bearer values. The separator, the `=` and the value's
// end are matched raw or percent-encoded once or twice, the forms a `next=`
// param carries. The value stops at `<`, so a masked value is not masked again.
const SECRET_PARAM =
  /((?:[?&#]|%(?:25)?(?:3F|26|23))(?:code|token|token_hash|access_token|refresh_token|provider_token|provider_refresh_token|id_token)(?:=|%(?:25)?3D))(?:(?!%(?:25)?(?:26|23))[^&#\s"'<>])+/gi;

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const CBU = /\b\d{22}\b/g;
const CUIT = /\b(?:20|23|24|27|30|33|34)-?\d{8}-?\d\b/g;
const DNI = /\b\d{1,2}\.?\d{3}\.?\d{3}\b/g;
// The lookbehind keeps the hex digits of a percent escape, raw or encoded
// (`%3Djohn%40…`, `%253Djohn%2540…`), out of the local part. The domain needs a TLD, so `pkg@2.71.1` in a pnpm path
// is not an address.
const EMAIL =
  /(?<!%(?:25)?[0-9A-Fa-f]?)(?:[A-Za-z0-9._+-]|%2B){1,64}(?:@|%40|%2540)[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}\b/g;

const SENSITIVE_SEGMENTS = new Set([
  "amount",
  "balance",
  "quantity",
  "price",
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
  "password",
  "secret",
  "cookie",
  "authorization",
  "apikey",
  "email",
]);

function scrubPersonalData(text: string): string {
  return text
    .replace(CBU, MASK)
    .replace(CUIT, MASK)
    .replace(DNI, MASK)
    .replace(EMAIL, MASK);
}

export function scrubSensitiveText(text: string): string {
  // Params first: Auth's PKCE `code` is itself a UUID.
  const withoutSecrets = text.replace(SECRET_PARAM, `$1${MASK}`);
  // Odd parts are UUIDs (ids, not personal data) and are kept: their digit
  // groups would otherwise read as a DNI.
  return withoutSecrets
    .split(UUID)
    .map((part, index) => (index % 2 === 1 ? part : scrubPersonalData(part)))
    .join("");
}

// A field whose name says it holds money, holdings, an identity number or a
// credential. Counts and durations of those are not values and pass.
export function isSensitiveKey(key: string): boolean {
  const segments = key
    .split(/[._-]|(?<=[a-z0-9])(?=[A-Z])/)
    .map((segment) => segment.toLowerCase());
  const last = segments.at(-1);
  const isCount =
    last === "count" ||
    (segments.at(-2) === "duration" && last === "ms") ||
    (key.startsWith("gen_ai.") && last === "tokens");
  // A pair of segments too, so `apiKey` and `api-key` read as `apikey`.
  return (
    !isCount &&
    segments.some(
      (segment, index) =>
        SENSITIVE_SEGMENTS.has(segment) ||
        SENSITIVE_SEGMENTS.has(segment + (segments[index + 1] ?? "")),
    )
  );
}
