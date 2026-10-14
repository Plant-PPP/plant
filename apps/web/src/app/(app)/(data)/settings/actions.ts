"use server";

import {
  type DisableOutcome,
  logDisable,
  unenrollForSession,
} from "@/lib/auth/mfa-disable";
import { requireSensitiveSession } from "@/lib/auth/sensitive-session";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { buenosAiresDate } from "@plant/shared";

import { readLiabilities } from "@/lib/debts/read";
import type { ExportTable } from "@/lib/export/csv";
import { readOtherHoldings } from "@/lib/export/read";
import { exportTables } from "@/lib/export/tables";
import { readImports } from "@/lib/imports/read";
import { readLedger } from "@/lib/ledger/read";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";
import { currentRequestId } from "@/lib/request-id-server";

type DisableResult = { outcome: DisableOutcome } | { stepUp: "sign_in_again" };

// Turns MFA off once the user signed in within the step-up window and the
// dialog verified a TOTP code just before. factorId comes from the browser:
// unenrollForSession accepts only one of the session user's own factors.
export async function disableTotp(factorId: unknown): Promise<DisableResult> {
  const requestId = await currentRequestId();
  if (typeof factorId !== "string") {
    return logDisable("invalid_input", { requestId });
  }
  const gate = await requireSensitiveSession("disable_mfa");
  if (!gate.ok) return { stepUp: gate.stepUp };
  return unenrollForSession({
    session: gate.session,
    claims: await getSessionClaims(),
    client: await createClient(),
    factorId,
    requestId,
  });
}

// Everything the session's user loaded, as the tables of an export, read
// under RLS when they ask for a file; null when it could not be read.
export async function exportData(): Promise<ExportTable[] | null> {
  const claims = await getSessionClaims();
  const requestId = await currentRequestId();
  const started = performance.now();
  const client = await createClient();
  try {
    const [{ ledger, truncated }, other, debts, { items }] = await Promise.all([
      readLedger(client, {
        today: buenosAiresDate(new Date()),
        referenceDollar: "mep",
      }),
      readOtherHoldings(client),
      readLiabilities(client),
      readImports(client),
    ]);
    const tables = exportTables({
      ...ledger,
      otherHoldings: other.rows,
      liabilities: debts.active,
      imports: items,
    });
    serverLog.info("settings.export", {
      [REQUEST_ID_FIELD]: requestId,
      "enduser.id": claims.sub,
      "plant.outcome": "ok",
      "plant.export.truncated":
        truncated || other.truncated || debts.activeTruncated,
      "plant.export.row_count": tables.reduce(
        (sum, table) => sum + table.rows.length,
        0,
      ),
      "plant.duration_ms": Math.round(performance.now() - started),
    });
    return tables;
  } catch (error) {
    serverLog.error(
      "settings.export",
      {
        [REQUEST_ID_FIELD]: requestId,
        "enduser.id": claims.sub,
        "plant.outcome": "failed",
        "plant.duration_ms": Math.round(performance.now() - started),
      },
      error,
    );
    return null;
  }
}
