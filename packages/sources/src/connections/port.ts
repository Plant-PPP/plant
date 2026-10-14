import { z } from "zod";

import { SourceError } from "../file-upload/draft";
import type { HoldingsReading, OperationsReading } from "../port";

// What a sync reads into its draft: the account's holdings, or the
// operations it made.
export const CONNECTION_DRAFTS = ["holdings", "operations"] as const;
export type ConnectionDraft = (typeof CONNECTION_DRAFTS)[number];
export const connectionDraftSchema = z.enum(CONNECTION_DRAFTS);

// How a provider's credential is known to only read: the provider says what
// it may do and the adapter checks it (checked), the credential cannot do
// more by design (inherent), the provider does not say and the user confirms
// the key they made reads only (confirmed), or the provider has no read-only
// credential at all (none), so Plant's own code, which calls only reading
// endpoints, is the only thing keeping it to reading.
export type ReadOnlyCheck = "checked" | "inherent" | "confirmed" | "none";

// A provider's credentials: named strings, as its schema takes them.
export type Credentials = Record<string, string>;

// One field of a credential form: its name in the schema, and whether it is
// a secret the form hides as it is typed.
export type CredentialField = { name: string; secret: boolean };

// What a provider reads and calls. Every call throws a SourceError:
// connection_rejected when the provider refuses the credentials (or they do
// not parse), connection_not_read_only when they can do more than read, and
// a retryable extraction_failed when the provider does not answer.
export interface ConnectionProviderPort {
  readonly provider: string;
  readonly fields: readonly CredentialField[];
  // The field whose last four characters the page shows to tell
  // credentials apart: no secret, unless it is the only field.
  readonly hintField: string;
  readonly readOnly: ReadOnlyCheck;
  readonly drafts: readonly ConnectionDraft[];
  // The credentials as the provider takes them, from untrusted input.
  parse(raw: unknown): Credentials | null;
  // Whether the credentials work, and read only where the provider tells.
  check(raw: unknown): Promise<void>;
  // The account's holdings or operations as the draft a file yields. A
  // provider checks again what it can: the user may have widened the key.
  read(
    raw: unknown,
    draft: ConnectionDraft,
  ): Promise<HoldingsReading | OperationsReading>;
}

type Spec<S extends z.ZodObject<Record<string, z.ZodString>>> = {
  provider: string;
  credentials: S;
  secrets: readonly (keyof z.infer<S> & string)[];
  hintField: keyof z.infer<S> & string;
  readOnly: ReadOnlyCheck;
  drafts: readonly ConnectionDraft[];
  check(credentials: z.infer<S>): Promise<void>;
  read(
    credentials: z.infer<S>,
    draft: ConnectionDraft,
  ): Promise<HoldingsReading | OperationsReading>;
};

// A provider's port from its credential schema and its two calls: every call
// parses the credentials first, and a draft it does not read is refused.
export function defineConnection<
  S extends z.ZodObject<Record<string, z.ZodString>>,
>(spec: Spec<S>): ConnectionProviderPort {
  const credentials = spec.credentials.strict();
  const parsed = (raw: unknown): z.infer<S> => {
    const result = credentials.safeParse(raw);
    if (!result.success) throw new SourceError("connection_rejected", false);
    return result.data as z.infer<S>;
  };
  return {
    provider: spec.provider,
    fields: Object.keys(spec.credentials.shape).map((name) => ({
      name,
      secret: (spec.secrets as readonly string[]).includes(name),
    })),
    hintField: spec.hintField,
    readOnly: spec.readOnly,
    drafts: spec.drafts,
    parse: (raw) => {
      const result = credentials.safeParse(raw);
      return result.success ? (result.data as Credentials) : null;
    },
    check: async (raw) => spec.check(parsed(raw)),
    read: async (raw, draft) => {
      if (!spec.drafts.includes(draft)) {
        throw new SourceError("unsupported", false);
      }
      return spec.read(parsed(raw), draft);
    },
  };
}

// What every adapter is built with: how it reaches the provider, what time
// it is, and how it waits; a test points the base URL at a fake.
export type ConnectionDeps = {
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};
