import type { Metadata } from "next";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { needsStepUp } from "@/lib/auth/sensitive-session";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/settings") };

export default async function SettingsPage() {
  return (
    <div>
      <h1 className="sr-only">{navTitle("/settings")}</h1>
      <TwoFactorCard stepUpNeeded={await needsStepUp()} />
    </div>
  );
}
