import "server-only";
import type { Database } from "@plant/shared";
import { z } from "zod";

import { createSourceConnection } from "@/app/(app)/(data)/accounts/actions";
import { createHolding } from "@/app/(app)/(data)/assets/actions";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { writeInstallments } from "@/lib/debts/installments-write";
import { writeLiability } from "@/lib/debts/write";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

import {
  PROPOSAL_KINDS,
  type ProposalKind,
  type ProposalTool,
} from "./proposals";

const answerSchema = z
  .object({
    messageId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    proposalId: z.string().min(1).max(100),
    decision: z.enum(["confirm", "decline"]),
  })
  .strict();

// A confirmed holdings or operations proposal is staged as an import: href is
// its review.
export type ProposalAnswer =
  | { ok: true; href?: string }
  | {
      ok: false;
      code: "invalid" | "not_found" | "answered" | "refused" | "failed";
    };

// The user's answer to one of the assistant's proposals. Confirming writes
// what the answer proposed, read back from the kept answer, never from the
// browser, through the same write the app's own forms use, as the session's
// user; then the answer is kept, so the card shows it and the model reads it
// next turn.
export async function answerProposal(input: unknown): Promise<ProposalAnswer> {
  const claims = await getSessionClaims();
  const requestId = await currentRequestId();
  const parsed = answerSchema.safeParse(input);
  let result: ProposalAnswer;
  let kind: ProposalKind | undefined;
  let failure: unknown;
  // Why the database refused a staged import, and its code.
  let staging: Staging | undefined;
  if (!parsed.success) {
    result = { ok: false, code: "invalid" };
  } else {
    const { messageId, proposalId, decision } = parsed.data;
    try {
      const client = await createClient();
      const read = await client
        .from("ai_messages")
        .select("role, parts, proposal_states")
        .eq("id", messageId)
        .limit(1);
      if (read.error) throw read.error;
      const message = read.data?.[0] as
        | {
            role: string;
            parts: unknown[];
            proposal_states: Record<string, unknown>;
          }
        | undefined;
      const record = async (state: "confirmed" | "declined") => {
        const updated = await client
          .from("ai_messages")
          .update({
            proposal_states: {
              ...message!.proposal_states,
              [proposalId]: state,
            } as Database["public"]["Tables"]["ai_messages"]["Update"]["proposal_states"],
          })
          .eq("id", messageId);
        if (updated.error) throw updated.error;
      };
      const part = (message?.role === "assistant" ? message.parts : []).find(
        (each): each is { type: string; output: { input?: unknown } } =>
          typeof each === "object" &&
          each !== null &&
          (each as { toolCallId?: unknown }).toolCallId === proposalId &&
          (each as { state?: unknown }).state === "output-available",
      );
      const tool = part?.type.slice("tool-".length) as ProposalTool;
      kind = part ? PROPOSAL_KINDS[tool] : undefined;
      if (!message || !part || !kind || !part.output.input) {
        result = { ok: false, code: "not_found" };
      } else if (message.proposal_states[proposalId] !== undefined) {
        result = { ok: false, code: "answered" };
      } else if (decision === "decline") {
        await record("declined");
        result = { ok: true };
      } else {
        const written =
          kind === "debt"
            ? await createDebt(part.output)
            : kind === "account"
              ? await createAccount(part.output.input)
              : kind === "real_estate"
                ? await createHolding(part.output.input)
                : await stageImport(kind, part.output.input);
        if ("staging" in written) staging = written.staging;
        if (!written.ok) {
          result = {
            ok: false,
            code: staging?.failed ? "failed" : "refused",
          };
        } else {
          await record("confirmed");
          result = {
            ok: true,
            ...("href" in written && { href: written.href }),
          };
        }
      }
    } catch (error) {
      failure = error;
      result = { ok: false, code: "failed" };
    }
  }
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.assistant.proposal_kind": kind,
    "plant.assistant.decision": parsed.success
      ? parsed.data.decision
      : undefined,
    "plant.outcome": result.ok ? "ok" : result.code,
    "plant.assistant.refusal": staging?.hint,
    "error.type": staging?.code,
    "plant.import.id": staging?.importId,
  };
  if (!result.ok && result.code === "failed") {
    serverLog.error("assistant.proposal", line, failure);
  } else serverLog.info("assistant.proposal", line);
  return result;
}

// An account proposed by its institution, in the user's first portfolio.
async function createAccount(input: unknown) {
  const institution = z.object({ institution: z.string() }).safeParse(input);
  if (!institution.success) return { ok: false as const };
  const client = await createClient();
  const portfolios = await client
    .from("portfolios")
    .select("id")
    .is("archived_at", null)
    .order("created_at")
    .limit(1);
  const portfolio = portfolios.data?.[0]?.id;
  if (!portfolio) return { ok: false as const };
  return createSourceConnection({
    institution: institution.data.institution,
    includeInTaxReport: true,
    defaultPortfolioId: portfolio,
  });
}

const stagedSchema = z.object({
  accountId: z.uuid(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
});

// How staging an import went, for the log: the import made, or the
// database's code and the hint of a refusal, and whether it failed rather
// than refused (an account or a debt that is not the user's, an account
// syncing, a bad row).
type Staging = {
  importId?: string;
  code?: string;
  hint?: string;
  failed?: boolean;
};

// The refusals stage_assistant_import names.
const STAGING_HINTS = [
  "counterpart_not_found",
  "debt_not_found",
  "sync_in_progress",
] as const;

// Holdings or operations staged as a ready import of the account, which the
// database checks is the user's, as any account or debt a row names; the
// user confirms them in its review.
async function stageImport(
  draft: "holdings" | "operations",
  input: unknown,
): Promise<
  | { ok: false; staging?: Staging }
  | { ok: true; href: string; staging: Staging }
> {
  const parsed = stagedSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const client = await createClient();
  const staged = await client.rpc("stage_assistant_import", {
    p_source_connection_id: parsed.data.accountId,
    p_draft: draft,
    p_rows: parsed.data
      .rows as Database["public"]["Functions"]["stage_assistant_import"]["Args"]["p_rows"],
  });
  if (staged.error || !staged.data) {
    const code = staged.error?.code;
    const refused = code === "PT404" || code === "PT409" || code === "22023";
    const hint = STAGING_HINTS.find((each) => each === staged.error?.hint);
    return {
      ok: false,
      staging: { code, failed: !refused, ...(hint && { hint }) },
    };
  }
  return {
    ok: true,
    href: `/import/${staged.data}`,
    staging: { importId: staged.data },
  };
}

// A proposed debt, and its installment plan when the proposal carries one.
async function createDebt(output: { input?: unknown; installments?: unknown }) {
  const created = await writeLiability("create_liability", null, output.input);
  if (!created.ok || output.installments === undefined) return created;
  return writeInstallments(created.id, output.installments);
}
