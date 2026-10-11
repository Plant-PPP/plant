import type { Denominator } from "@plant/core";

// The units the assistant answers in.
export const CHAT_UNITS = [
  "ars",
  "usd_mep",
  "usd_ccl",
] as const satisfies readonly Denominator[];
export type ChatUnit = (typeof CHAT_UNITS)[number];

// A chart an answer carries: bars, each a label and a value in the
// conversation's unit. Its numbers come from the data, never from the text.
export type ChartPart = {
  title: string;
  unit: ChatUnit;
  bars: { label: string; value: string }[];
};

export type UserMessage = {
  id: string;
  role: "user";
  text: string;
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  text: string;
  chart: ChartPart | null;
  // What it consulted, named for the user.
  sources: string[];
  // The day its data is from, and the dollar it used when the unit is one.
  asOf: string;
  rate: { label: string; sell: string } | null;
  followUps: string[];
};

export type ChatMessage = UserMessage | AssistantMessage;

export type Conversation = {
  id: string;
  // Its first question, cut short.
  title: string;
  unit: ChatUnit;
  messages: ChatMessage[];
  updatedOn: string;
};

// The most questions a month on the beta plan. A question counts once asked,
// even if its conversation is deleted later.
export const QUESTIONS_PER_MONTH = 30;

export const SUGGESTED_QUESTIONS = [
  "¿Cuánto vale mi patrimonio hoy?",
  "¿Cómo me fue este año?",
  "¿Cuánto cobré de dividendos?",
  "¿Cuánto debo?",
  "¿Cómo le fue a Apple?",
];

export const NOT_ADVICE =
  "Plant explica tus datos; no es asesoramiento financiero.";

export const titleOf = (question: string): string =>
  question.length > 48 ? `${question.slice(0, 47).trimEnd()}…` : question;
