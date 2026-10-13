jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
jest.mock("@/app/(app)/(data)/assistant/actions", () => ({}));

import type { AssistantMessage } from "@/lib/assistant/chat";
import { toChatMessages } from "@/lib/assistant/messages-view";

import { asUIMessage } from "./assistant-chat";

it("keeps an answer's charts when a conversation is opened again", () => {
  const answer: AssistantMessage = {
    id: "a",
    role: "assistant",
    text: "Creció.",
    charts: [
      {
        kind: "line",
        title: "Patrimonio neto al cierre de cada mes",
        unit: "usd_mep",
        points: [{ label: "septiembre 2026", value: "120" }],
      },
    ],
    table: null,
    sources: ["Cierres"],
    asOf: "2026-10-13",
    rate: null,
  };
  expect(toChatMessages([asUIMessage(answer)])).toEqual([answer]);
});
