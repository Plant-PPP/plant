"use server";

import {
  type DisableOutcome,
  logDisable,
  unenrollForSession,
} from "@/lib/auth/mfa-disable";
import { requireSensitiveSession } from "@/lib/auth/sensitive-session";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { buenosAiresDate } from "@plant/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type AlertWriteResult, newAlertSchema } from "@/lib/alerts/alerts";
import { createAlert, deleteAlert, markAlertSeen } from "@/lib/alerts/read";
import { readLiabilities, readLiabilityEvents } from "@/lib/debts/read";
import { auditedExport } from "@/lib/export/export-audit-sink";
import type { ExportTable } from "@/lib/export/csv";
import { EXPORT_IMPORTS_LIMIT, readOtherHoldings } from "@/lib/export/read";
import { type ExportAnswer, exportTables } from "@/lib/export/tables";
import { readImports } from "@/lib/imports/read";
import { readLedger } from "@/lib/ledger/read";
import { refreshGainAlerts } from "@/lib/ledger/write";
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

async function readExport(
  client: Awaited<ReturnType<typeof createClient>>,
): Promise<{ tables: ExportTable[]; truncated: boolean }> {
  const [{ ledger, truncated }, other, debts, events, imports] =
    await Promise.all([
      readLedger(client, {
        today: buenosAiresDate(new Date()),
        referenceDollar: "mep",
      }),
      readOtherHoldings(client),
      readLiabilities(client),
      readLiabilityEvents(client),
      readImports(client, { limit: EXPORT_IMPORTS_LIMIT }),
    ]);
  return {
    tables: exportTables({
      ...ledger,
      otherHoldings: other.rows,
      liabilities: debts.active,
      liabilityEvents: events.byLiability,
      imports: imports.items,
    }),
    truncated:
      truncated ||
      other.truncated ||
      debts.activeTruncated ||
      events.cut ||
      imports.truncated,
  };
}

// Everything the session's user loaded, as the tables of an export, read
// under RLS.
export async function exportData(): Promise<ExportAnswer> {
  return auditedExport(async () => readExport(await createClient()));
}

const alertId = z.uuid();
type AlertAction = "create" | "delete" | "seen";

// Runs one write over the session's user's price alerts, logs it and
// refreshes the pages that show them.
async function alertWrite(
  action: AlertAction,
  write: (
    client: Awaited<ReturnType<typeof createClient>>,
    userId: string,
  ) => Promise<AlertWriteResult>,
): Promise<AlertWriteResult> {
  const claims = await getSessionClaims();
  const line = {
    [REQUEST_ID_FIELD]: await currentRequestId(),
    "enduser.id": claims.sub,
    "plant.alerts.action": action,
  };
  try {
    const result = await write(await createClient(), claims.sub);
    serverLog.info("alerts.write", { ...line, "plant.outcome": result });
    if (result === "ok") {
      revalidatePath("/");
      revalidatePath("/settings");
    }
    return result;
  } catch (error) {
    serverLog.error(
      "alerts.write",
      { ...line, "plant.outcome": "failed" },
      error,
    );
    return "failed";
  }
}

// Sets an alert from the form. A gain alert has its figure worked out from
// the user's movements at once.
export async function createPriceAlert(
  input: unknown,
): Promise<AlertWriteResult> {
  const parsed = newAlertSchema.safeParse(input);
  if (!parsed.success) return "invalid";
  return alertWrite("create", async (client, userId) => {
    const result = await createAlert(client, parsed.data);
    if (result === "ok" && parsed.data.subjectKind === "gain") {
      await refreshGainAlerts(userId);
    }
    return result;
  });
}

export async function deletePriceAlert(id: unknown): Promise<boolean> {
  const parsed = alertId.safeParse(id);
  if (!parsed.success) return false;
  const result = await alertWrite("delete", async (client) => {
    await deleteAlert(client, parsed.data);
    return "ok";
  });
  return result === "ok";
}

// Marks a met alert seen, so Resumen no longer shows it.
export async function seePriceAlert(id: unknown): Promise<boolean> {
  const parsed = alertId.safeParse(id);
  if (!parsed.success) return false;
  const result = await alertWrite("seen", async (client) => {
    await markAlertSeen(client, parsed.data);
    return "ok";
  });
  return result === "ok";
}
