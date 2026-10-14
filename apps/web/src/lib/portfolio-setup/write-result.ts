import {
  PORTFOLIO_SETUP_GUARD,
  type PortfolioSetupGuardHint,
} from "@plant/shared";
import {
  knownHint,
  type PostgrestFailure,
} from "@/lib/supabase/postgrest-write";

export type WriteResultCode =
  PortfolioSetupGuardHint | "duplicate" | "not_found" | "invalid" | "failed";

export type WriteResult =
  { ok: true; id: string } | { ok: false; code: WriteResultCode };

// What a refused write means to the user.
export function toWriteResult(
  failure: PostgrestFailure,
  hint: unknown,
): WriteResultCode {
  const guarded = knownHint([PORTFOLIO_SETUP_GUARD], failure, hint);
  if (guarded !== undefined) return guarded;
  if (failure.code === "23505") return "duplicate";
  return "failed";
}
