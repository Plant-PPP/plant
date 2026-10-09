import {
  PORTFOLIO_SETUP_GUARD,
  type PortfolioSetupGuardHint,
} from "@plant/shared";
import type { PostgrestFailure } from "@/lib/supabase/postgrest-write";

export type WriteResultCode =
  | PortfolioSetupGuardHint
  | "duplicate_name"
  | "not_found"
  | "invalid"
  | "failed";

export type WriteResult =
  { ok: true; id: string } | { ok: false; code: WriteResultCode };

function guardHint(hint: unknown): PortfolioSetupGuardHint | undefined {
  return PORTFOLIO_SETUP_GUARD.hints.find((known) => known === hint);
}

// What a refused write means to the user. A guard's hint is read only against
// the known list, since an unknown one could carry any text.
export function toWriteResult(
  { code }: PostgrestFailure,
  hint: unknown,
): WriteResultCode {
  if (code === PORTFOLIO_SETUP_GUARD.sqlstate)
    return guardHint(hint) ?? "failed";
  if (code === "23505") return "duplicate_name";
  if (code === "23503") return "not_found";
  return "failed";
}
