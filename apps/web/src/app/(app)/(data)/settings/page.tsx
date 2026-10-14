import type { Metadata } from "next";
import { PrototypeSettings } from "@/components/prototype/prototype-settings";
import { AlertsCard } from "@/components/settings/alerts-card";
import { ExportCard } from "@/components/settings/export-card";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import type { PriceAlert } from "@/lib/alerts/alerts";
import { readAlerts } from "@/lib/alerts/read";
import { needsStepUp } from "@/lib/auth/sensitive-session";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { isProductionDeployment } from "@/lib/deployment";
import { serverLog } from "@/lib/log/server-log";
import { navTitle } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";

import { createPriceAlert, deletePriceAlert, exportData } from "./actions";

export const metadata: Metadata = { title: navTitle("/settings") };

// The user's price alerts; none, logged, when they could not be read.
async function userAlerts(): Promise<PriceAlert[]> {
  const claims = await getSessionClaims();
  try {
    return await readAlerts(await createClient());
  } catch (error) {
    serverLog.error(
      "alerts.read",
      {
        "enduser.id": claims.sub,
        "plant.page": "/settings",
        "plant.outcome": "failed",
      },
      error,
    );
    return [];
  }
}

// Ajustes. Two-factor sign-in is always the real one; outside production the
// cards over the user's data show the prototype's, and in production the
// alerts and the export are the user's own.
export default async function SettingsPage() {
  return (
    <div className="grid gap-6">
      <h1 className="sr-only">{navTitle("/settings")}</h1>
      <TwoFactorCard stepUpNeeded={await needsStepUp()} />
      {isProductionDeployment() ? (
        <>
          <AlertsCard
            alerts={await userAlerts()}
            onCreate={createPriceAlert}
            onDelete={deletePriceAlert}
          />
          <ExportCard load={exportData} />
        </>
      ) : (
        <PrototypeSettings />
      )}
    </div>
  );
}
