import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Seals what an account's API key needs (the key and its secret) with
// AES-256-GCM under CONNECTION_SECRETS_KEY, a server key of 32 bytes in
// base64. The sealed text is bound to `context`, the row's user, account and
// exchange, so a sealed key copied to another row does not open. Format:
// v1.<iv>.<tag>.<ciphertext>, each base64url, as
// public.account_api_keys.secret_ciphertext checks it.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  override readonly name = "SecretBoxError";
  constructor(readonly code: "unconfigured" | "malformed" | "unopened") {
    super(`secret box failed: ${code}`);
  }
}

// The server key, or null when the deployment has none or it is not 32
// bytes.
export function secretsKey(
  env: Record<string, string | undefined> = process.env,
): Buffer | null {
  const raw = env.CONNECTION_SECRETS_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

// What a sealed key is bound to.
export const sealContext = (
  userId: string,
  accountId: string,
  provider: string,
) => `plant.account_api_keys:${userId}:${accountId}:${provider}`;

export function seal(plain: string, context: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    sealed.toString("base64url"),
  ].join(".");
}

// Throws a SecretBoxError when the text is not sealed, or not by this key
// for this context.
export function open(sealed: string, context: string, key: Buffer): string {
  const [version, iv, tag, body, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body || rest.length > 0) {
    throw new SecretBoxError("malformed");
  }
  const ivBytes = Buffer.from(iv, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
    throw new SecretBoxError("malformed");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, ivBytes, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretBoxError("unopened");
  }
}
