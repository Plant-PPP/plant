"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { suggestionsFor } from "@/lib/assistant/suggestions";
import { isUnder } from "@/lib/paths";

import { PrototypeChat } from "./prototype-chat";

// Every prototype page but Asistente's own, with the assistant beside it
// offering questions about that page.
export function PrototypeAssistantPanel({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isUnder("/assistant", pathname)) return children;
  return (
    <AssistantPanel
      chat={<PrototypeChat compact suggestions={suggestionsFor(pathname)} />}
    >
      {children}
    </AssistantPanel>
  );
}
