import "server-only";
import type { Database } from "@plant/shared";
import { z } from "zod";

import { createSourceConnection } from "@/app/(app)/(data)/accounts/actions";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { writeLiability } from "@/lib/debts/write";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

import { PROPOSAL_KINDS, type ProposalTool } from "./proposals";

const answerSchema = z
  .object({
    messageId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    proposalId: z.string().min(1).max(100),
    decision: z.enum(["confirm", "decline"]),
  })
  .strict();

export type ProposalAnswer =
  | { ok: true }
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
  let kind: string | undefined;
  let failure: unknown;
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
            ? await writeLiability("create_liability", null, part.output.input)
            : await createAccount(part.output.input);
        if (!written.ok) {
          result = { ok: false, code: "refused" };
        } else {
          await record("confirmed");
          result = { ok: true };
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
