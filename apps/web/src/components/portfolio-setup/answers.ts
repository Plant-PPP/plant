import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

// What the card does with an action's answer, or with a rejected call
// (network, version skew).
export type Answer =
  { kind: "done" } | { kind: "alert"; text: string } | { kind: "ask_name" };

// A restore whose name an active portfolio took asks for another name; an
// archive has no name to change, so the same code is only an alert there.
export function rowAnswer(
  result: WriteResult | "rejected",
  action: "archive" | "restore",
): Answer {
  if (result === "rejected")
    return { kind: "alert", text: WRITE_MESSAGES.failed };
  if (result.ok) return { kind: "done" };
  if (result.code === "duplicate_name" && action === "restore") {
    return { kind: "ask_name" };
  }
  return { kind: "alert", text: WRITE_MESSAGES[result.code] };
}

// A name sheet closes on success and otherwise stays open with the alert.
export function sheetAnswer(
  result: WriteResult | "rejected",
): { kind: "done" } | { kind: "alert"; text: string } {
  if (result === "rejected")
    return { kind: "alert", text: WRITE_MESSAGES.failed };
  if (result.ok) return { kind: "done" };
  return { kind: "alert", text: WRITE_MESSAGES[result.code] };
}
