import type { Metadata } from "next";
import { PrototypeSettings } from "@/components/prototype/prototype-settings";
import { ExportCard } from "@/components/settings/export-card";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { needsStepUp } from "@/lib/auth/sensitive-session";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

import { exportData } from "./actions";

export const metadata: Metadata = { title: navTitle("/settings") };

// Ajustes. Two-factor sign-in is always the real one; outside production the
// cards over the user's data show the prototype's, and in production the
// export reads the user's own.
export default async function SettingsPage() {
  return (
    <div className="grid gap-6">
      <h1 className="sr-only">{navTitle("/settings")}</h1>
      <TwoFactorCard stepUpNeeded={await needsStepUp()} />
      {isProductionDeployment() ? (
        <ExportCard load={exportData} />
      ) : (
        <PrototypeSettings />
      )}
    </div>
  );
}
