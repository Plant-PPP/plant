import type { Metadata } from "next";
import { TwoFactorCard } from "@/components/settings/two-factor-card";
import { firstParam } from "@/lib/auth/routes";
import { needsStepUp } from "@/lib/auth/sensitive-session";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/settings") };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { confirm } = await searchParams;
  return (
    <div>
      <h1 className="sr-only">{navTitle("/settings")}</h1>
      <TwoFactorCard
        stepUpNeeded={await needsStepUp()}
        confirmDisable={firstParam(confirm) === "disable"}
      />
    </div>
  );
}
