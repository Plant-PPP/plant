import { CHART_TEMPLATES, type ChartTemplate } from "@/lib/charts/templates";
import {
  CHART_KINDS,
  CHART_TOPICS,
  type ChartTopic,
  CHAT_UNITS,
  type ChartPart,
  type ChatMessage,
  MAX_CHART_POINTS,
  MAX_CHARTS,
} from "./chat";
import {
  type ProposalView,
  proposalsOf,
  type QuestionView,
  questionOf,
} from "./proposals";

// A chat message as stored or streamed: its parts and what the answer says
// under it.
export type MessageLike = {
  id: string;
  role: string;
  parts: readonly unknown[];
  metadata?: unknown;
  // What the user answered to its proposals, as kept.
  proposalStates?: Readonly<Record<string, unknown>>;
};

// The text of a message's parts, a paragraph each; its tool calls and steps
// are left out. Each step of a turn writes a part of its own, so they never
// run together.
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
    .map((text) => text.trim())
    .filter((text) => text !== "")
    .join("\n\n");

const isText = (value: unknown): value is string => typeof value === "string";

// Which of the assistant's charts a kept one is, when it says so.
function sourceOf(value: unknown): Pick<ChartPart, "source"> {
  if (typeof value !== "object" || value === null) return {};
  const { topic, portfolioId } = value as Record<string, unknown>;
  if (!CHART_TOPICS.includes(topic as ChartTopic)) return {};
  if (portfolioId !== null && !isText(portfolioId)) return {};
  return { source: { topic: topic as ChartTopic, portfolioId } };
}

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
      ...(CHART_TEMPLATES.includes(chart.template as ChartTemplate) && {
        template: chart.template as ChartTemplate,
      }),
      ...sourceOf(chart.source),
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

// Each message as the transcript shows it, kept while the message is the
// same object: the chat replaces only the one streaming, so the others keep
// their identity and the transcript does not render them again.
const shownOf = new WeakMap<MessageLike, ChatMessage[]>();

// The chat's messages as the transcript shows them: a question's text, an
// answer's text, its charts and what it read, the day and its dollar. An
// answer still streaming has no day yet.
export function toChatMessages(
  messages: readonly MessageLike[],
): ChatMessage[] {
  return messages.flatMap((message) => {
    let shown = shownOf.get(message);
    if (!shown) {
      shown = chatMessageOf(message);
      shownOf.set(message, shown);
    }
    return shown;
  });
}

function chatMessageOf(message: MessageLike): ChatMessage[] {
  const text = textOf(message.parts);
  const meta = (
    typeof message.metadata === "object" && message.metadata !== null
      ? message.metadata
      : {}
  ) as Record<string, unknown>;
  if (message.role === "user") {
    // Kept, its files' names; just sent, its file parts.
    const attachments = Array.isArray(meta.attachments)
      ? meta.attachments.filter(isText)
      : message.parts.flatMap((part) => {
          const file = part as { type?: unknown; filename?: unknown };
          return file.type === "file" && isText(file.filename)
            ? [file.filename]
            : [];
        });
    return [
      {
        id: message.id,
        role: "user",
        text,
        ...(attachments.length > 0 && { attachments }),
      },
    ];
  }
  if (message.role !== "assistant") return [];
  const { asOf, rate, sources, charts } = metadataOf(message.metadata);
  // A reopened answer carries its proposals in its metadata; a streamed or
  // kept one, in its tool parts.
  const proposals = Array.isArray(meta.proposals)
    ? (meta.proposals as ProposalView[])
    : proposalsOf(message.parts, message.proposalStates ?? {});
  const question =
    meta.question !== undefined
      ? ((meta.question as QuestionView | null) ?? null)
      : questionOf(message.parts);
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
      ...(proposals.length > 0 && { proposals }),
      ...(question && { question }),
    },
  ];
}
