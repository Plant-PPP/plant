"use client";

import { createContext, useContext } from "react";

// The icons the user gave their own institutions, by name, so every screen
// that names an account shows its logo, not only the accounts page.
const InstitutionIcons = createContext<ReadonlyMap<string, string>>(new Map());

const keyOf = (name: string) => name.trim().toLocaleLowerCase("es-AR");

export function InstitutionIconsProvider({
  icons,
  children,
}: {
  icons: readonly { institution: string; icon: string }[];
  children: React.ReactNode;
}) {
  return (
    <InstitutionIcons.Provider
      value={new Map(icons.map((each) => [keyOf(each.institution), each.icon]))}
    >
      {children}
    </InstitutionIcons.Provider>
  );
}

export const useInstitutionIcon = (name: string): string | undefined =>
  useContext(InstitutionIcons).get(keyOf(name));
