"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { ExportCard } from "@/components/settings/export-card";
import { PreferencesCard } from "@/components/settings/preferences-card";

import { exportFiles } from "./prototype-export";
import { usePrototype } from "./prototype-provider";

// Ajustes' cards over the prototype's store. Deleting the account leaves it
// as a new user's, who lands on Resumen.
export function PrototypeSettings() {
  const { state, actions } = usePrototype();
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
      <ExportCard files={exportFiles(state)} />
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
