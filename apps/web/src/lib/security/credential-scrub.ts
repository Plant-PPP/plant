// Masks credentials and personal data in text before it is logged. Every
// pattern stays linear on hostile input: nested repeats are bounded, and the
// timing tests pin the worst shapes.

export const MASK = "<masked>";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
  .source;
// Right after a percent escape, raw or encoded once (not three times): its
// hex digits belong to the escape, so `%2012345678` is a space and a DNI.
const AFTER_ESCAPE = /(?<=%(?:25)?[0-9A-Fa-f]{2})/.source;

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

// Credentials outside a query: a credential named in JSON, escaped JSON or
// `name: value` form (a quoted or backticked value runs to its closing
// quote), the PKCE code as a named UUID, a bearer or basic value, a JWT
// (whole or cut), Supabase's auth and verifier cookies and secret keys, and
// Inngest's signing keys. A letter before `code`, `Bearer` or `eyJ` means
// another word; a digit may be a mask's neighbour.
const NAMED_SECRET = new RegExp(
  String.raw`((?:${AUTH_TOKEN}|code_verifier|api[_-]?key|passw(?:or)?d|service[_-]?role[_-]?key|(?:client_)?secret(?:[_-]?key)?|(?:private|signing|event)[_-]?key)(?:\\?")?\s{0,8}[:=]\s{0,8})("(?:[^"\\]|\\.)*|\\"[^"\\]*|'(?:[^'\\]|\\.)*|\\'[^'\\]*|\`[^\`]*|[^"'\\\s,}&<]+)`,
  "gi",
);
const NAMED_CODE = new RegExp(
  String.raw`((?<![A-Za-z])(?:(?:auth|oauth|pkce)_?)?code(?:\\?")?\s{0,8}[:=]\s{0,8}(?:\\?"|')?)${UUID}`,
  "gi",
);
const AUTHORIZATION = /((?<![A-Za-z])(?:Bearer|Basic)\s+)[^\s"',<]+/gi;
const JWT = /(?<![A-Za-z])eyJ[\w.-]{6,}/g;
const SUPABASE_AUTH_COOKIE =
  /(sb-[\w-]{1,64}-auth-token(?:-code-verifier)?(?:\.\d+)?=)[^;\s"<]+/g;
const SUPABASE_SECRET_KEY = /sb_secret_[\w-]+/g;
const INNGEST_SIGNING_KEY = /signkey-(?:prod|test|branch)-[\w-]+/g;

// Kept whole: ids and times, whose digit groups would otherwise read as a
// DNI. A UUID; a hex run of 16 or more with a letter (a trace id, a hash, a
// chunk name), unless it is 11 or more digits with only letters around them,
// a CBU or CUIT glued to a word; a time with its fraction (a comma one up to
// microseconds, so a CSV's next field is not read as one); a basic ISO
// timestamp. Not followed by `@`: an id used as an email's local part is not
// an id. A DNI glued to hex letters, or a CUIT or CBU in a hex run that holds
// other digits too, reads as a hex id and passes.
const KEPT = String.raw`(?:${UUID}|(?:(?<![0-9a-z])|${AFTER_ESCAPE})(?<!%(?:25)?[0-9a-f]?)(?![a-f]*\d{11,}[a-f]*(?![0-9a-z]))(?=[0-9a-f]*[a-f])[0-9a-f]{16,}(?![0-9a-z])|(?<!\d)(?:\d{2}:\d{2}:\d{2}(?:\.\d{1,9}|,\d{1,6})?|\d{8}T\d{6}(?:\.\d{1,9})?)(?!\d|\.\d))(?!@|%(?:25)?40)`;

// Bounded by digits, not `\b`, so a number glued to `_` or a word, as in a
// file name, is masked; a percent escape's hex digits do not count. A DNI may
// follow a dot (`nro.12345678`) but not sit between a digit and a dot. Any
// other 7 or 8 digits, a byte count or a date in a file name, read as a DNI.
const CBU = String.raw`(?:(?<!\d)|${AFTER_ESCAPE})\d{22}(?!\d)`;
const CUIT = String.raw`(?:(?<!\d)|${AFTER_ESCAPE})(?:20|23|24|27|30|33|34)[-. ]?\d{8}[-. ]?\d(?!\d)`;
// Two DNIs joined by a dot, as in a file name or a CSV row, which the DNI's
// own bounds read as one dotted number.
const DNI_PAIR = String.raw`(?<!\d|\d\.)\d{7,8}(?:\.\d{7,8})+(?!\d|\.\d)`;
const DNI = String.raw`(?:(?<!\d|\d\.)|${AFTER_ESCAPE}|(?<=%(?:25)?[0-9A-Fa-f]{2}\.))\d{1,2}\.?\d{3}\.?\d{3}(?!\d|\.\d)`;
// The lookbehind keeps the hex digits of a percent escape, raw or encoded
// (`%3Djohn%40…`, `%253Djohn%2540…`), out of the local part; an escape inside
// it, encoded once or twice, is a `+` or a byte of a non-ASCII letter. It
// does not start with `'`, the closing quote of a value before it. The domain
// needs a TLD, so `pkg@2.71.1` in a pnpm path is not an address.
const EMAIL = String.raw`(?<!%(?:25)?[0-9A-Fa-f]?)(?!')(?:[\p{L}\p{N}._+'-]|%(?:25)?2[Bb]|%(?:25)?[89A-Fa-f][0-9A-Fa-f]){1,64}(?:@|%40|%2540)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,24}(?!\p{L})`;

// One pass, so every pattern sees the whole text. At each position a kept id
// wins, then an email over the numbers in its local part.
const PERSONAL_DATA = new RegExp(
  `(${KEPT})|${EMAIL}|${CBU}|${CUIT}|${DNI_PAIR}|${DNI}`,
  "giu",
);

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
  "otp",
  "verifier",
  "credential",
  "credentials",
  "cookie",
  "cookies",
  "authorization",
  "authcode",
  "oauthcode",
  "pkcecode",
  "apikey",
  "privatekey",
  "signingkey",
  "servicerole",
  "email",
  "phone",
]);

export function scrubSensitiveText(text: string): string {
  // Secrets first: Auth's PKCE `code` is itself a UUID.
  const withoutSecrets = text
    .replace(SECRET_PARAM, `$1${MASK}`)
    .replace(
      NAMED_SECRET,
      (_match, name: string, value: string) =>
        `${name}${/^(?:\\?"|\\?'|`)/.exec(value)?.[0] ?? ""}${MASK}`,
    )
    .replace(NAMED_CODE, `$1${MASK}`)
    .replace(AUTHORIZATION, `$1${MASK}`)
    .replace(SUPABASE_AUTH_COOKIE, `$1${MASK}`)
    .replace(JWT, MASK)
    .replace(SUPABASE_SECRET_KEY, MASK)
    .replace(INNGEST_SIGNING_KEY, MASK);
  return scrubPersonalData(scrubPersonalData(withoutSecrets));
}

// Run twice: a DNI right after a CUIT and a dot (`20123456789.12345678`)
// reads as part of a dotted number until the CUIT is masked.
function scrubPersonalData(text: string): string {
  return text.replace(
    PERSONAL_DATA,
    (_match, kept: string | undefined) => kept ?? MASK,
  );
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
  return (
    names(SECRET_SEGMENTS) ||
    (last !== "id" && last !== "ids" && names(VALUE_SEGMENTS))
  );
}
