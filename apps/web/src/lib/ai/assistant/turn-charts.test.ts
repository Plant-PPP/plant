jest.mock("server-only", () => ({}), { virtual: true });

const CHART: {
  kind: "line" | "bars";
  title: string;
  unit: "usd_mep";
  points: { label: string; value: string }[];
} = {
  kind: "line",
  title: "Patrimonio neto al cierre de cada mes",
  unit: "usd_mep",
  points: [
    { label: "agosto 2026", value: "100" },
    { label: "septiembre 2026", value: "120" },
  ],
};
let mockChart = CHART;
let mockDrawn = 0;
jest.mock("@/lib/assistant/tools-data", () => ({
  ...jest.requireActual("@/lib/assistant/tools-data"),
  assistantData: () => ({
    chart: async () => ({
      sources: ["Cierres"],
      asOf: "2026-10-13",
      rate: null,
      complete: true,
      unit: "usd_mep",
      chart: { ...mockChart, title: `${mockChart.title} ${(mockDrawn += 1)}` },
    }),
  }),
}));

import type { LanguageModelMiddleware } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import type { AssistantStore, StoredMessage } from "@/lib/assistant/store";

import { runAssistantTurn } from "./turn";

type Wrap = Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0];
type StreamResult = Awaited<ReturnType<Wrap["doStream"]>>;
type LanguageModelV3StreamPart =
  StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const streamOf = (parts: LanguageModelV3StreamPart[]) =>
  new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });

const steps = (calls = 1) => [
  streamOf([
    { type: "stream-start", warnings: [] },
    ...Array.from({ length: calls }, (_, index): LanguageModelV3StreamPart => ({
      type: "tool-call",
      toolCallId: String(index),
      toolName: "renderChart",
      input: JSON.stringify({ kind: "net_worth" }),
    })),
    {
      type: "finish",
      usage,
      finishReason: { unified: "tool-calls", raw: undefined },
    },
  ]),
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: "Creció un 20 %." },
    { type: "text-end", id: "t" },
    {
      type: "finish",
      usage,
      finishReason: { unified: "stop", raw: undefined },
    },
  ]),
];

const env = process.env.ANTHROPIC_API_KEY;
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterAll(() => {
  process.env.ANTHROPIC_API_KEY = env;
});

async function answer(calls = 1) {
  const saved: StoredMessage[][] = [];
  const store: AssistantStore = {
    reserveQuestion: async () => "ok",
    conversation: async () => null,
    startConversation: async () => {},
    history: async () => [],
    saveTurn: async (_user, { messages }) => {
      saved.push(messages);
    },
  };
  const queue = steps(calls);
  const response = await runAssistantTurn({
    client: {} as never,
    store,
    record: async () => {},
    model: () =>
      new MockLanguageModelV3({
        doStream: async () => ({ stream: queue.shift()! }),
      }),
    context: {
      userId: "11111111-1111-4111-8111-111111111111",
      requestId: undefined,
      page: "/assistant",
      params: {},
    },
    conversationId: "22222222-2222-4222-8222-222222222222",
    question: "¿Cómo evolucionó mi patrimonio?",
    unit: "usd_mep",
    today: "2026-10-13",
    report: () => {},
  });
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return saved[0]?.[1];
}

it("keeps the chart a tool drew with the answer", async () => {
  expect((await answer())?.metadata).toMatchObject({
    charts: [{ ...CHART, title: expect.stringContaining(CHART.title) }],
    sources: ["Cierres"],
  });
});

it("keeps only the charts that fit what a message's metadata may take", async () => {
  mockChart = {
    kind: "bars",
    title: "Tus tenencias más grandes",
    unit: "usd_mep",
    points: Array.from({ length: 12 }, (_, index) => ({
      label: "Сбербанк Россия ГДР акции".padEnd(30, "ж") + index,
      value: "123456789012.12345678",
    })),
  };
  try {
    const metadata = (await answer(3))?.metadata as { charts: unknown[] };
    expect(metadata.charts.length).toBeLessThan(3);
    expect(
      new TextEncoder().encode(JSON.stringify(metadata)).length,
    ).toBeLessThanOrEqual(3300);
  } finally {
    mockChart = CHART;
  }
});
