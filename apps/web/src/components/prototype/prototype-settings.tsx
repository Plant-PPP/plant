"use client";

import { MANUAL_RATE_KINDS } from "@plant/core";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AlertsCard } from "@/components/settings/alerts-card";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { ExportCard } from "@/components/settings/export-card";
import { PreferencesCard } from "@/components/settings/preferences-card";
import { RatesCard } from "@/components/settings/rates-card";
import { heldInstruments, withGainFigures } from "@/lib/alerts/gain";
import { exportTables } from "@/lib/export/tables";

import { usePrototype } from "./prototype-provider";

// Ajustes' cards over the prototype's store. Deleting the account leaves it
// as a new user's, who lands on Resumen.
export function PrototypeSettings() {
  const { state, snapshot, manualRates, actions } = usePrototype();
  const router = useRouter();
  return (
    <>
      <PreferencesCard
        preferences={{
          referenceDollar: state.referenceDollar,
          preferredUnit: state.preferredUnit,
        }}
        onChange={actions.preferences.set}
      />
      <RatesCard
        rates={MANUAL_RATE_KINDS.map((kind) => ({
          kind,
          sell: snapshot.fx[kind]?.sell ?? null,
          date: snapshot.fx[kind]?.date ?? null,
          manual: manualRates.has(kind),
        }))}
        today={state.today}
        onSet={actions.rates.set}
        onRevert={actions.rates.revert}
      />
      <AlertsCard
        alerts={withGainFigures(state, state.priceAlerts)}
        instruments={heldInstruments(state)}
        onCreate={actions.alerts.create}
        onDelete={actions.alerts.delete}
      />
      <ExportCard load={async () => exportTables(state)} />
      <DeleteAccountCard
        onDelete={() => {
          actions.deleteAccount();
          toast.success("Borramos tu cuenta y todo lo que tenía.");
          router.push("/");
        }}
      />
    </>
  );
}
