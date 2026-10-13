"use client";

import { PreferencesCard } from "@/components/settings/preferences-card";

import { usePrototype } from "./prototype-provider";

// Ajustes' cards over the prototype's store.
export function PrototypeSettings() {
  const { state, actions } = usePrototype();
  return (
    <PreferencesCard
      preferences={{
        referenceDollar: state.referenceDollar,
        preferredUnit: state.preferredUnit,
      }}
      onChange={actions.preferences.set}
    />
  );
}
