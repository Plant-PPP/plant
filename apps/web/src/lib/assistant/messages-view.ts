import {
  CHART_KINDS,
  CHAT_UNITS,
  type ChartPart,
  type ChatMessage,
  MAX_CHART_POINTS,
  MAX_CHARTS,
} from "./chat";

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

const isText = (value: unknown): value is string => typeof value === "string";

// A chart as kept with an answer, or nothing when it is not one.
const chartOf = (value: unknown): ChartPart[] => {
  if (typeof value !== "object" || value === null) return [];
  const chart = value as Record<string, unknown>;
  const points = Array.isArray(chart.points) ? chart.points : [];
  if (
    !CHART_KINDS.includes(chart.kind as ChartPart["kind"]) ||
    !CHAT_UNITS.includes(chart.unit as ChartPart["unit"]) ||
    !isText(chart.title)
  ) {
    return [];
  }
  return [
    {
      kind: chart.kind as ChartPart["kind"],
      unit: chart.unit as ChartPart["unit"],
      title: chart.title,
      points: points.slice(0, MAX_CHART_POINTS).flatMap((point) => {
        const { label, value } = (point ?? {}) as Record<string, unknown>;
        return isText(label) && isText(value) ? [{ label, value }] : [];
      }),
    },
  ];
};

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
    charts: Array.isArray(value.charts)
      ? value.charts.flatMap(chartOf).slice(0, MAX_CHARTS)
      : [],
  };
};

// The chat's messages as the transcript shows them: a question's text, an
// answer's text, its charts and what it read, the day and its dollar. An
// answer still streaming has no day yet.
export function toChatMessages(
  messages: readonly MessageLike[],
): ChatMessage[] {
  return messages.flatMap((message): ChatMessage[] => {
    const text = textOf(message.parts);
    if (message.role === "user") {
      return [{ id: message.id, role: "user", text }];
    }
    if (message.role !== "assistant") return [];
    const { asOf, rate, sources, charts } = metadataOf(message.metadata);
    return [
      {
        id: message.id,
        role: "assistant",
        text,
        charts,
        table: null,
        sources,
        asOf: asOf ?? "",
        rate,
      },
    ];
  });
}
