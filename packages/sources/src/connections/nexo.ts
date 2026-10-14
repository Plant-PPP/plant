import { z } from "zod";

import type { DraftRow } from "../file-upload/draft";
import {
  base64Of,
  call,
  decimalOf,
  hmacSha256,
  holdingsReading,
  jsonOf,
  positive,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";

export const NEXO_PRO_BASE_URL = "https://pro.nexo.com/api/v1";

export const nexoCredentialsSchema = z.object({
  apiKey: z.string().regex(/^[A-Za-z0-9_+/=-]{8,256}$/),
  apiSecret: z.string().regex(/^[A-Za-z0-9_+/=-]{8,256}$/),
});
type NexoCredentials = z.infer<typeof nexoCredentialsSchema>;

const summarySchema = z.object({
  balances: z.array(
    z.object({ assetName: z.string(), totalBalance: z.unknown() }),
  ),
});

const ASSET = /^[A-Z0-9]{1,20}$/;

const signature = async (secret: string, nonce: string) =>
  base64Of(await hmacSha256(secret, nonce));

// Nexo Pro by API, with a key the user made with the VIEWER role. Nexo Pro
// does not say what a key may do, so the user confirms its role. Each
// request is signed: the base64 HMAC-SHA256 of a nonce (the time in
// milliseconds) under the secret. Plant calls only GETs.
export function nexoConnection({
  baseUrl = NEXO_PRO_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
}: ConnectionDeps = {}) {
  const signedGet = async (
    path: string,
    { apiKey, apiSecret }: NexoCredentials,
  ): Promise<unknown> => {
    const nonce = String(now().getTime());
    const response = await call(
      get,
      `${baseUrl}${path}`,
      {
        headers: {
          "X-API-KEY": apiKey,
          "X-NONCE": nonce,
          "X-SIGNATURE": await signature(apiSecret, nonce),
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
    const body = await jsonOf(response);
    if (response.ok) return body;
    if (response.status === 401 || response.status === 403) throw rejected();
    throw unavailable();
  };

  const summary = async (credentials: NexoCredentials) => {
    const parsed = summarySchema.safeParse(
      await signedGet("/accountSummary", credentials),
    );
    if (!parsed.success) throw unavailable();
    return parsed.data;
  };

  return defineConnection({
    provider: "nexo",
    credentials: nexoCredentialsSchema,
    secrets: ["apiSecret"],
    hintField: "apiKey",
    readOnly: "confirmed",
    drafts: ["holdings"],
    check: async (credentials) => {
      await summary(credentials);
    },
    async read(credentials) {
      const rows: DraftRow[] = [];
      let skipped = 0;
      for (const { assetName, totalBalance } of (await summary(credentials))
        .balances) {
        const symbol = assetName.trim().toUpperCase();
        const quantity = decimalOf(totalBalance);
        if (quantity !== null && !positive(quantity)) continue;
        if (!ASSET.test(symbol) || quantity === null) {
          skipped += 1;
          continue;
        }
        rows.push({
          symbol,
          quantity,
          price: null,
          value: null,
          currency: "USD",
          confidence: "high",
          page: null,
        });
      }
      return holdingsReading(rows, skipped, now());
    },
  });
}
