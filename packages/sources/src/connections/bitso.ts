import { z } from "zod";

import {
  balancesReading,
  call,
  hexOf,
  hmacSha256,
  jsonOf,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";

export const BITSO_BASE_URL = "https://bitso.com";

const BALANCE_PATH = "/api/v3/balance/";

export const bitsoCredentialsSchema = z.object({
  apiKey: z.string().regex(/^[A-Za-z0-9]{6,64}$/),
  apiSecret: z.string().regex(/^[A-Za-z0-9]{16,128}$/),
});
type BitsoCredentials = z.infer<typeof bitsoCredentialsSchema>;

const balanceSchema = z.object({
  success: z.literal(true),
  payload: z.object({
    balances: z.array(z.object({ currency: z.string(), total: z.unknown() })),
  }),
});

// Six random digits, every value equally likely: a draw past the last whole
// million of the 32-bit range is drawn again.
const SALT_LIMIT = 4_294_000_000;
function saltOf(): string {
  for (;;) {
    const [draw] = crypto.getRandomValues(new Uint32Array(1));
    if (draw! < SALT_LIMIT) return String(draw! % 1_000_000).padStart(6, "0");
  }
}

// A nonce Bitso takes (its v2): the time in milliseconds and a random salt
// of six digits, so two requests in the same millisecond still differ.
const nonceOf = (now: Date) => `${now.getTime()}${saltOf()}`;

// Bitso by API, with a key the user made with only "View balances" and "View
// account information". Bitso does not say what a key may do, so the user
// confirms it. Each request is signed: the hex HMAC-SHA256 of the nonce, the
// method and the path under the secret. Plant calls only GETs, and reads no
// trades: Bitso lists them only to a key that may place orders.
export function bitsoConnection({
  baseUrl = BITSO_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
}: ConnectionDeps = {}) {
  const balances = async ({ apiKey, apiSecret }: BitsoCredentials) => {
    const nonce = nonceOf(now());
    const signature = hexOf(
      await hmacSha256(apiSecret, `${nonce}GET${BALANCE_PATH}`),
    );
    const response = await call(
      get,
      `${baseUrl}${BALANCE_PATH}`,
      {
        headers: {
          Authorization: `Bitso ${apiKey}:${nonce}:${signature}`,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
    const body = await jsonOf(response);
    // 401 holds every authentication error (a wrong key or signature, an IP
    // the key does not take, a key without "View balances").
    if (response.status === 401 || response.status === 403) throw rejected();
    const parsed = balanceSchema.safeParse(body);
    if (!response.ok || !parsed.success) throw unavailable();
    return parsed.data.payload.balances;
  };

  return defineConnection({
    provider: "bitso",
    credentials: bitsoCredentialsSchema,
    secrets: ["apiSecret"],
    hintField: "apiKey",
    readOnly: "confirmed",
    drafts: ["holdings"],
    check: async (credentials) => {
      await balances(credentials);
    },
    async read(credentials) {
      const held = await balances(credentials);
      return balancesReading(
        held.map(({ currency, total }) => ({ code: currency, parts: [total] })),
        now(),
      );
    },
  });
}
