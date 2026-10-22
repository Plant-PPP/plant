// What the assistant proposes to load, and what it asks when it is not
// sure: each comes back as the output of one of its tools, kept with the
// answer. Nothing is written until the user confirms its card.

// The tools whose output is a proposal, by what they would write.
export const PROPOSAL_KINDS = {
  proposeDebt: "debt",
  proposeAccount: "account",
  proposeHoldings: "holdings",
  proposeOperations: "operations",
  proposeRealEstate: "real_estate",
} as const;
export type ProposalTool = keyof typeof PROPOSAL_KINDS;
export type ProposalKind = (typeof PROPOSAL_KINDS)[ProposalTool];

export const ASK_TOOL = "askUser";

export type ProposalState = "pending" | "confirmed" | "declined";

// A proposal as its card shows it: what it would load, in lines.
export type ProposalView = {
  id: string;
  kind: ProposalKind;
  title: string;
  lines: string[];
  state: ProposalState;
};

// A question with the answers the user picks from.
export type QuestionView = { id: string; text: string; options: string[] };

// What a proposal tool hands back: the card's words, or why it could not
// propose, for the model to fix or ask.
export type ProposalOutput =
  | { proposal: { title: string; lines: string[] }; input: unknown }
  | { error: string };

type ToolPart = {
  type: string;
  toolCallId?: unknown;
  state?: unknown;
  output?: unknown;
};

const toolParts = (parts: readonly unknown[]): ToolPart[] =>
  parts.filter(
    (part): part is ToolPart =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      typeof part.type === "string" &&
      part.type.startsWith("tool-"),
  );

const isText = (value: unknown): value is string => typeof value === "string";

// The parts of an answer the chat keeps: its text, its proposals and its
// question, each once its tool answered.
export const isKeptPart = (part: unknown): boolean => {
  if (typeof part !== "object" || part === null || !("type" in part)) {
    return false;
  }
  if (part.type === "text") return true;
  const tool = part as ToolPart;
  return (
    tool.state === "output-available" &&
    (tool.type === `tool-${ASK_TOOL}` ||
      Object.keys(PROPOSAL_KINDS).some((name) => tool.type === `tool-${name}`))
  );
};

// The proposals of an answer's parts, each with what the user answered.
export function proposalsOf(
  parts: readonly unknown[],
  states: Readonly<Record<string, unknown>>,
): ProposalView[] {
  return toolParts(parts).flatMap((part) => {
    const name = part.type.slice("tool-".length) as ProposalTool;
    const kind = PROPOSAL_KINDS[name];
    if (!kind || part.state !== "output-available") return [];
    if (!isText(part.toolCallId)) return [];
    const output = part.output as { proposal?: unknown } | undefined;
    const proposal = output?.proposal as
      { title?: unknown; lines?: unknown } | undefined;
    if (!proposal || !isText(proposal.title)) return [];
    const state = states[part.toolCallId];
    return [
      {
        id: part.toolCallId,
        kind,
        title: proposal.title,
        lines: Array.isArray(proposal.lines)
          ? proposal.lines.filter(isText)
          : [],
        state:
          state === "confirmed" || state === "declined" ? state : "pending",
      },
    ];
  });
}

// The question an answer ends with, if it asks one.
export function questionOf(parts: readonly unknown[]): QuestionView | null {
  const part = toolParts(parts)
    .filter(
      (each) =>
        each.type === `tool-${ASK_TOOL}` && each.state === "output-available",
    )
    .at(-1);
  const asked = (part?.output as { question?: unknown } | undefined)
    ?.question as { text?: unknown; options?: unknown } | undefined;
  if (!part || !isText(part.toolCallId) || !asked || !isText(asked.text)) {
    return null;
  }
  return {
    id: part.toolCallId,
    text: asked.text,
    options: Array.isArray(asked.options)
      ? asked.options.filter(isText).slice(0, 4)
      : [],
  };
}

// What the model reads of the proposals it made and how the user answered,
// as a line each under the answer.
export const proposalsNote = (
  parts: readonly unknown[],
  states: Readonly<Record<string, unknown>>,
): string =>
  proposalsOf(parts, states)
    .map(
      (each) =>
        `[Propuesta "${each.title}": ${
          each.state === "confirmed"
            ? each.kind === "holdings" || each.kind === "operations"
              ? "el usuario la confirmó y la está revisando en Cargar"
              : "el usuario la confirmó y quedó cargada"
            : each.state === "declined"
              ? "el usuario la descartó"
              : "sin respuesta del usuario todavía"
        }]`,
    )
    .join("\n");
