jest.mock("server-only", () => ({}), { virtual: true });

import { MockLanguageModelV3 } from "ai/test";

import type { AssistantStore, StoredMessage } from "@/lib/assistant/store";

import { runAssistantTurn, type TurnReport } from "./turn";

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";

function storeWith(quota: "ok" | "quota" = "ok") {
  const saved: StoredMessage[][] = [];
  const started: { id: string; title: string; unit: string }[] = [];
  const store: AssistantStore = {
    reserveQuestion: jest.fn(async () => quota),
    conversation: jest.fn(async () => null),
    startConversation: jest.fn(async (_user, conversation) => {
      started.push(conversation);
    }),
    history: jest.fn(async () => []),
    saveTurn: jest.fn(async (_user, { messages }) => {
      saved.push(messages);
    }),
  };
  return { store, saved, started };
}

const turn = (
  store: AssistantStore,
  question: string,
  report: TurnReport = () => {},
) =>
  runAssistantTurn({
    client: {} as never,
    store,
    record: async () => {},
    context: {
      userId: USER,
      requestId: undefined,
      page: "/assistant",
      params: {},
    },
    conversationId: CONVERSATION,
    question,
    unit: "usd_mep",
    today: "2026-10-13",
    report,
  });

const env = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterAll(() => {
  process.env.ANTHROPIC_API_KEY = env;
});

it("refuses a question past the month's, before reading anything", async () => {
  const { store } = storeWith("quota");
  const outcomes: unknown[] = [];
  const response = await turn(store, "¿Cuánto debo?", (r) => {
    outcomes.push(r.outcome);
  });
  expect(response.status).toBe(429);
  expect(await response.text()).toBe("Ya usaste las consultas de este mes.");
  expect(store.conversation).not.toHaveBeenCalled();
  expect(outcomes).toContain("quota");
});

it("says the chat is not set up without a model key, counting nothing", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { store } = storeWith();
  const response = await turn(store, "¿Cuánto debo?");
  expect(response.status).toBe(503);
  expect(store.reserveQuestion).not.toHaveBeenCalled();
});

it("answers what to buy with the fixed text, without a model, and keeps both messages", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { store, saved, started } = storeWith();
  const reports: Parameters<TurnReport>[0][] = [];
  const response = await turn(store, "¿Qué compro?", (r) => {
    reports.push(r);
  });
  const body = await response.text();
  expect(body).toContain("Plant explica tus datos y no recomienda");
  expect(started).toEqual([
    { id: CONVERSATION, title: "¿Qué compro?", unit: "usd_mep" },
  ]);
  expect(saved).toHaveLength(1);
  const [question, answer] = saved[0] as [StoredMessage, StoredMessage];
  expect(question).toMatchObject({
    role: "user",
    parts: [{ type: "text", text: "¿Qué compro?" }],
  });
  expect(answer.role).toBe("assistant");
  expect(answer.id).toMatch(/^msg/);
  expect(question.id).not.toBe(answer.id);
  expect(reports).toContainEqual({ outcome: "advice" });
  expect(reports).toContainEqual({ done: true });
});

it("keeps an existing conversation's unit", async () => {
  const { store, started } = storeWith();
  store.conversation = jest.fn(async () => ({ unit: "ars" as const }));
  await (await turn(store, "¿Qué compro?")).text();
  expect(started).toEqual([]);
});

it("starts no conversation when the answer fails", async () => {
  const { store, started, saved } = storeWith();
  const response = await runAssistantTurn({
    client: {} as never,
    store,
    record: async () => {},
    model: () =>
      new MockLanguageModelV3({
        doStream: async () => {
          throw new Error("provider down");
        },
      }),
    context: {
      userId: USER,
      requestId: undefined,
      page: "/assistant",
      params: {},
    },
    conversationId: CONVERSATION,
    question: "¿Cuánto debo?",
    unit: "usd_mep",
    today: "2026-10-13",
    report: () => {},
  });
  await response.text();
  expect(started).toEqual([]);
  expect(saved).toEqual([]);
});
