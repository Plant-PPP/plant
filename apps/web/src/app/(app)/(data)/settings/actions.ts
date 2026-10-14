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
import { readLiabilities } from "@/lib/debts/read";
import { recordExport } from "@/lib/export/audit";
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
  const [{ ledger, truncated }, other, debts, imports] = await Promise.all([
    readLedger(client, {
      today: buenosAiresDate(new Date()),
      referenceDollar: "mep",
    }),
    readOtherHoldings(client),
    readLiabilities(client),
    readImports(client, { limit: EXPORT_IMPORTS_LIMIT }),
  ]);
  return {
    tables: exportTables({
      ...ledger,
      otherHoldings: other.rows,
      liabilities: debts.active,
      imports: imports.items,
    }),
    truncated:
      truncated ||
      other.truncated ||
      debts.activeTruncated ||
      imports.truncated,
  };
}

// Everything the session's user loaded, as the tables of an export, read
// under RLS once the step-up lets them through. Each try leaves an audit row
// with its outcome, and the tables go out only once theirs is written.
export async function exportData(): Promise<ExportAnswer> {
  const requestId = await currentRequestId();
  const gate = await requireSensitiveSession("export");
  const claims = await getSessionClaims();
  const client = await createClient();
  const started = performance.now();
  const failed = (step: "audit" | "read", error: unknown) =>
    serverLog.error(
      "settings.export",
      {
        [REQUEST_ID_FIELD]: requestId,
        "enduser.id": claims.sub,
        "plant.outcome": "failed",
        "plant.export.step": step,
        "plant.duration_ms": Math.round(performance.now() - started),
      },
      error,
    );

  if (!gate.ok) {
    await recordExport(client, "denied", requestId).catch((error: unknown) =>
      failed("audit", error),
    );
    return { stepUp: gate.stepUp };
  }
  let answer: { tables: ExportTable[]; truncated: boolean };
  try {
    answer = await readExport(client);
  } catch (error) {
    failed("read", error);
    await recordExport(client, "failure", requestId).catch((auditError) =>
      failed("audit", auditError),
    );
    return null;
  }
  try {
    await recordExport(client, "success", requestId);
  } catch (error) {
    failed("audit", error);
    return null;
  }
  serverLog.info("settings.export", {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.outcome": "ok",
    "plant.export.truncated": answer.truncated,
    "plant.export.row_count": answer.tables.reduce(
      (sum, table) => sum + table.rows.length,
      0,
    ),
    "plant.duration_ms": Math.round(performance.now() - started),
  });
  return answer;
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
