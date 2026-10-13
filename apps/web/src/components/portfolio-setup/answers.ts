import {
  type NoticeLink,
  portfolioInUseMessage,
  type WriteMessages,
} from "@/lib/portfolio-setup/messages";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { Result } from "./optimistic-writes";

// The copy for each code a write can be refused with, and for a failed call.
export type MessagesFor<R extends Result> = Record<
  Extract<R, { ok: false }>["code"] | "failed",
  string
>;

export type { WriteMessages };

// What the section does with an action's answer, or with a rejected call
// (network, version skew).
// An alert may carry the page where the user can do what it asks.
export type Answer =
  | { kind: "done" }
  | { kind: "alert"; text: string; link?: NoticeLink }
  | { kind: "ask_name" };

// The page each refusal code points to, for the codes that have one.
export type LinksFor<R extends Result> = Partial<
  Record<keyof MessagesFor<R>, NoticeLink>
>;

// A restore whose name an active row took asks for another name; an archive
// has no name to change, so the same code is only an alert there. An archive
// refused because active accounts use the row names those accounts.
export function rowAnswer(
  result: WriteResult | "rejected",
  action: "archive" | "restore",
  messages: WriteMessages,
  {
    usedBy = [],
    links,
  }: { usedBy?: string[]; links?: LinksFor<WriteResult> } = {},
): Answer {
  if (result !== "rejected" && !result.ok) {
    if (result.code === "duplicate" && action === "restore") {
      return { kind: "ask_name" };
    }
    if (result.code === "portfolio_in_use") {
      return { kind: "alert", text: portfolioInUseMessage(usedBy) };
    }
  }
  return dialogAnswer(result, messages, links);
}

export function dialogAnswer<R extends Result>(
  result: R | "rejected",
  messages: MessagesFor<R>,
  links?: LinksFor<R>,
): Exclude<Answer, { kind: "ask_name" }> {
  if (result === "rejected") return { kind: "alert", text: messages.failed };
  if (result.ok) return { kind: "done" };
  const code = result.code as keyof MessagesFor<R>;
  const link = links?.[code];
  return link
    ? { kind: "alert", text: messages[code], link }
    : { kind: "alert", text: messages[code] };
}
