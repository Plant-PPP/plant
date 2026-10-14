import { z } from "zod";

import {
  balancesReading,
  base64Of,
  call,
  hmacSha256,
  jsonOf,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";

export const RIPIO_TRADE_BASE_URL = "https://api.ripiotrade.co/v4";

const TOKEN = /^[A-Za-z0-9_+/=.-]{16,256}$/;

export const ripioCredentialsSchema = z.object({
  apiToken: z.string().regex(TOKEN),
  secretKey: z.string().regex(TOKEN),
});
type RipioCredentials = z.infer<typeof ripioCredentialsSchema>;

const balancesSchema = z.object({
  data: z.array(
    z.object({
      currency_code: z.string(),
      available_amount: z.unknown(),
      locked_amount: z.unknown(),
    }),
  ),
});

// Ripio Trade by its v4 API, with a token the user made with the Read access
// only. Ripio does not say what a token may do, so the user confirms it.
// Each request is signed: the base64 HMAC-SHA256 of the time in
// milliseconds, the method and the request's path (its query left out) under
// the secret. Plant calls only GETs.
export function ripioConnection({
  baseUrl = RIPIO_TRADE_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
}: ConnectionDeps = {}) {
  const signedGet = async (
    path: string,
    { apiToken, secretKey }: RipioCredentials,
  ): Promise<unknown> => {
    const url = `${baseUrl}${path}`;
    const timestamp = String(now().getTime());
    const signature = base64Of(
      await hmacSha256(secretKey, `${timestamp}GET${new URL(url).pathname}`),
    );
    const response = await call(
      get,
      url,
      {
        headers: {
          Authorization: apiToken,
          Timestamp: timestamp,
          Signature: signature,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
    const body = await jsonOf(response);
    if (response.ok) return body;
    if (response.status === 401 || response.status === 403) throw rejected();
    // Rate limits (429), maintenance (503), Ripio down.
    throw unavailable();
  };

  const balances = async (credentials: RipioCredentials) => {
    const parsed = balancesSchema.safeParse(
      await signedGet("/user/balances", credentials),
    );
    if (!parsed.success) throw unavailable();
    return parsed.data.data;
  };

  return defineConnection({
    provider: "ripio",
    credentials: ripioCredentialsSchema,
    secrets: ["secretKey"],
    hintField: "apiToken",
    readOnly: "confirmed",
    drafts: ["holdings"],
    check: async (credentials) => {
      await balances(credentials);
    },
    async read(credentials) {
      return balancesReading(
        (await balances(credentials)).map((each) => ({
          code: each.currency_code,
          parts: [each.available_amount, each.locked_amount],
        })),
        now(),
      );
    },
  });
}
