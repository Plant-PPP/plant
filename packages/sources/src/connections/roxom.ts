import { z } from "zod";

import {
  balancesReading,
  base64Of,
  call,
  jsonOf,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";

export const ROXOM_BASE_URL = "https://api.roxom.com";

const BEGIN = "-----BEGIN PRIVATE KEY-----";
const END = "-----END PRIVATE KEY-----";

// A PKCS#8 private key in PEM, as Roxom hands it out. A form's input drops
// the line breaks, so any whitespace inside is taken.
const PEM = new RegExp(`^\\s*${BEGIN}[\\sA-Za-z0-9+/=]{100,4000}${END}\\s*$`);

export const roxomCredentialsSchema = z.object({
  apiKey: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  privateKey: z.string().max(4096).regex(PEM),
});
type RoxomCredentials = z.infer<typeof roxomCredentialsSchema>;

const balanceSchema = z.object({
  data: z.object({
    balances: z.array(z.object({ asset: z.string(), current: z.unknown() })),
  }),
});

// The key the PEM holds, for RSASSA-PKCS1-v1_5 with SHA-256 (what `openssl
// dgst -sha256 -sign` makes); null when it holds none.
async function signingKey(
  pem: string,
): Promise<Awaited<ReturnType<typeof crypto.subtle.importKey>> | null> {
  const body = pem.trim().slice(BEGIN.length, -END.length).replace(/\s/g, "");
  try {
    const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    return null;
  }
}

// Roxom by API. Its keys cannot be limited to reading, so the user confirms
// they understand that and Plant calls only GETs. Each request is signed
// with the user's RSA private key: the base64 signature of `METHOD:path`,
// the path with its query, as sent. Roxom keeps only the public key; Plant
// keeps the private one in Vault like any other secret.
export function roxomConnection({
  baseUrl = ROXOM_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
}: ConnectionDeps = {}) {
  const signedGet = async (
    path: string,
    { apiKey, privateKey }: RoxomCredentials,
  ): Promise<unknown> => {
    const key = await signingKey(privateKey);
    if (key === null) throw rejected();
    const url = new URL(`${baseUrl}${path}`);
    const signed = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`GET:${url.pathname}${url.search}`),
    );
    const response = await call(
      get,
      url.toString(),
      {
        headers: {
          "X-API-Key": apiKey,
          "X-API-Signature": base64Of(new Uint8Array(signed)),
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

  // Each asset's balance, BTC in bitcoin rather than sats.
  const balances = async (credentials: RoxomCredentials) => {
    const parsed = balanceSchema.safeParse(
      await signedGet("/v1/accounts/balance?unit=btc", credentials),
    );
    if (!parsed.success) throw unavailable();
    return parsed.data.data.balances;
  };

  return defineConnection({
    provider: "roxom",
    credentials: roxomCredentialsSchema,
    secrets: ["privateKey"],
    hintField: "apiKey",
    readOnly: "none",
    drafts: ["holdings"],
    check: async (credentials) => {
      await balances(credentials);
    },
    async read(credentials) {
      return balancesReading(
        (await balances(credentials)).map(({ asset, current }) => ({
          code: asset,
          parts: [current],
        })),
        now(),
      );
    },
  });
}
