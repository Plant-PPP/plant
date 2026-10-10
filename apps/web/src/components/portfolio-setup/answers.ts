import { inUseMessage } from "@/lib/portfolio-setup/messages";
import type {
  WriteResult,
  WriteResultCode,
} from "@/lib/portfolio-setup/write-result";

export type WriteMessages = Record<WriteResultCode, string>;

// What the section does with an action's answer, or with a rejected call
// (network, version skew).
export type Answer =
  { kind: "done" } | { kind: "alert"; text: string } | { kind: "ask_name" };

// A restore whose name an active row took asks for another name; an archive
// has no name to change, so the same code is only an alert there. An archive
// refused because active accounts use the row names those accounts.
export function rowAnswer(
  result: WriteResult | "rejected",
  action: "archive" | "restore",
  messages: WriteMessages,
  usedBy: string[] = [],
): Answer {
  if (result !== "rejected" && !result.ok) {
    if (result.code === "duplicate_name" && action === "restore") {
      return { kind: "ask_name" };
    }
    if (result.code === "portfolio_in_use" || result.code === "holder_in_use") {
      return { kind: "alert", text: inUseMessage(result.code, usedBy) };
    }
  }
  return dialogAnswer(result, messages);
}

export function dialogAnswer(
  result: WriteResult | "rejected",
  messages: WriteMessages,
): { kind: "done" } | { kind: "alert"; text: string } {
  if (result === "rejected") return { kind: "alert", text: messages.failed };
  if (result.ok) return { kind: "done" };
  return { kind: "alert", text: messages[result.code] };
}
