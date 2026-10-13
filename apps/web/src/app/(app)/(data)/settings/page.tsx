import type { Metadata } from "next";
import { PrototypeSettings } from "@/components/prototype/prototype-settings";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { needsStepUp } from "@/lib/auth/sensitive-session";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/settings") };

// Ajustes. Two-factor sign-in is always the real one; outside production the
// cards over the user's data show the prototype's.
export default async function SettingsPage() {
  return (
    <div className="grid gap-6">
      <h1 className="sr-only">{navTitle("/settings")}</h1>
      <TwoFactorCard stepUpNeeded={await needsStepUp()} />
      {!isProductionDeployment() && <PrototypeSettings />}
    </div>
  );
}
