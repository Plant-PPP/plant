import type { ChatMessage } from "./chat";

// A chat message as stored or streamed: its parts and what the answer says
// under it.
export type MessageLike = {
  id: string;
  role: string;
  parts: readonly unknown[];
  metadata?: unknown;
};

// The text of a message's parts, joined; its tool calls and steps are left out.
export const textOf = (parts: readonly unknown[]) =>
  parts
    .flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("");

const metadataOf = (metadata: unknown) => {
  const value =
    typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>)
      : {};
  const rate = value.rate as { label?: unknown; sell?: unknown } | null;
  return {
    asOf: typeof value.asOf === "string" ? value.asOf : null,
    rate:
      rate && typeof rate.label === "string" && typeof rate.sell === "string"
        ? { label: rate.label, sell: rate.sell }
        : null,
    sources: Array.isArray(value.sources)
      ? value.sources.filter(
          (source): source is string => typeof source === "string",
        )
      : [],
  };
};

// The chat's messages as the transcript shows them: a question's text, an
// answer's text and what it read, the day and its dollar. An answer still
// streaming has no day yet.
export function toChatMessages(
  messages: readonly MessageLike[],
): ChatMessage[] {
  return messages.flatMap((message): ChatMessage[] => {
    const text = textOf(message.parts);
    if (message.role === "user") {
      return [{ id: message.id, role: "user", text }];
    }
    if (message.role !== "assistant") return [];
    const { asOf, rate, sources } = metadataOf(message.metadata);
    return [
      {
        id: message.id,
        role: "assistant",
        text,
        charts: [],
        table: null,
        sources,
        asOf: asOf ?? "",
        rate,
      },
    ];
  });
}
