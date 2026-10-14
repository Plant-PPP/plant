import { Constants } from "@plant/shared";
import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => null,
}));

import { assistantSink, createAssistantStore } from "./assistant-sink";
import { CHAT_UNITS } from "./chat";
import { AssistantStoreError, type StoredMessage } from "./store";

type Call = { method: string; url: URL; headers: Headers; body: unknown };
type Answer = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function storeWith(answer: (call: Call) => Answer) {
  const calls: Call[] = [];
  const fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        method: init?.method ?? "GET",
        url: new URL(String(input)),
        headers: new Headers(init?.headers),
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      };
      calls.push(call);
      const { status, body, headers } = answer(call);
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    },
  );
  const client = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { store: createAssistantStore(client as never), calls };
}

const USER = "a0000000-0000-4000-8000-00000000000a";
const CONVERSATION = "c0000000-0000-4000-8000-0000000000c1";

const question: StoredMessage = {
  id: "msg-q",
  role: "user",
  parts: [{ type: "text", text: "¿Cuánto tengo?" }],
  metadata: null,
};
const answer: StoredMessage = {
  id: "msg-a",
  role: "assistant",
  parts: [{ type: "text", text: "Tenés $ 1.000" }],
  metadata: { asOf: "2026-10-13" },
};

it("answers in the units the database keeps", () => {
  expect([...CHAT_UNITS].sort()).toEqual(
    [...Constants.public.Enums.chat_unit].sort(),
  );
});

describe("reserveQuestion", () => {
  it("records a question for the user", async () => {
    const { store, calls } = storeWith(() => ({ status: 201 }));
    expect(await store.reserveQuestion(USER)).toBe("ok");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/rest/v1/ai_questions");
    expect(calls[0]!.body).toEqual({ user_id: USER });
  });

  it("says when the month's questions are used up", async () => {
    const { store } = storeWith(() => ({
      status: 429,
      body: { code: "PT429", message: "the month's questions are used up" },
    }));
    expect(await store.reserveQuestion(USER)).toBe("quota");
  });

  it("throws any other failure", async () => {
    const { store } = storeWith(() => ({
      status: 500,
      body: { code: "XX000" },
    }));
    const error = await store.reserveQuestion(USER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistantStoreError);
    expect(error).toMatchObject({ step: "reserve", code: "XX000" });
  });
});

describe("conversation", () => {
  it("reads the unit of the user's conversation", async () => {
    const { store, calls } = storeWith(() => ({
      status: 200,
      body: [{ unit: "usd_mep" }],
    }));
    expect(await store.conversation(USER, CONVERSATION)).toEqual({
      unit: "usd_mep",
    });
    const params = calls[0]!.url.searchParams;
    expect(params.get("user_id")).toBe(`eq.${USER}`);
    expect(params.get("id")).toBe(`eq.${CONVERSATION}`);
  });

  it("reads nothing when the user has no such conversation", async () => {
    const { store } = storeWith(() => ({ status: 200, body: [] }));
    expect(await store.conversation(USER, CONVERSATION)).toBeNull();
  });
});

it("starts a conversation under the user, keeping one already there", async () => {
  const { store, calls } = storeWith(() => ({ status: 201 }));
  await store.startConversation(USER, {
    id: CONVERSATION,
    title: "¿Cuánto tengo?",
    unit: "ars",
  });
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.url.searchParams.get("on_conflict")).toBe("user_id,id");
  expect(calls[0]!.headers.get("prefer")).toContain(
    "resolution=ignore-duplicates",
  );
  expect(calls[0]!.body).toEqual({
    user_id: USER,
    id: CONVERSATION,
    title: "¿Cuánto tengo?",
    unit: "ars",
  });
});

describe("history", () => {
  it("reads the user's last turns, oldest first", async () => {
    const { store, calls } = storeWith(() => ({
      status: 200,
      body: [answer, question],
    }));
    expect(await store.history(USER, CONVERSATION, 10)).toEqual([
      question,
      answer,
    ]);
    const params = calls[0]!.url.searchParams;
    expect(params.get("user_id")).toBe(`eq.${USER}`);
    expect(params.get("conversation_id")).toBe(`eq.${CONVERSATION}`);
    expect(params.get("order")).toBe("created_at.desc,role.asc,id.desc");
    expect(params.get("limit")).toBe("20");
  });

  it("refuses a row that is not a message", async () => {
    const { store } = storeWith(() => ({
      status: 200,
      body: [{ ...question, role: "system" }],
    }));
    const error = await store
      .history(USER, CONVERSATION, 10)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ step: "history", code: "invalid_row" });
  });
});

describe("saveTurn", () => {
  it("adds the messages and counts the user's questions", async () => {
    const { store, calls } = storeWith((call) => {
      if (call.method === "POST") return { status: 201 };
      if (call.method === "HEAD")
        return { status: 200, headers: { "content-range": "*/3" } };
      return { status: 204 };
    });
    await store.saveTurn(USER, {
      conversationId: CONVERSATION,
      messages: [question, answer],
    });

    const [insert, count, update] = calls;
    expect(insert!.url.pathname).toBe("/rest/v1/ai_messages");
    expect(insert!.body).toEqual([
      { user_id: USER, conversation_id: CONVERSATION, ...question },
      { user_id: USER, conversation_id: CONVERSATION, ...answer },
    ]);

    expect(count!.method).toBe("HEAD");
    expect(count!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
    expect(count!.url.searchParams.get("conversation_id")).toBe(
      `eq.${CONVERSATION}`,
    );
    expect(count!.url.searchParams.get("role")).toBe("eq.user");

    expect(update!.method).toBe("PATCH");
    expect(update!.url.pathname).toBe("/rest/v1/ai_conversations");
    expect(update!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
    expect(update!.url.searchParams.get("id")).toBe(`eq.${CONVERSATION}`);
    expect(update!.body).toEqual({ questions: 3 });
  });

  it("throws a store error with only the step and code", async () => {
    const { store, calls } = storeWith(() => ({
      status: 400,
      body: { code: "23514", details: "Tenés $ 1.000" },
    }));
    const error = await store
      .saveTurn(USER, { conversationId: CONVERSATION, messages: [answer] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistantStoreError);
    expect(error).toMatchObject({ step: "save", code: "23514" });
    expect(String(error)).not.toContain("1.000");
    expect(calls).toHaveLength(1);
  });
});

it("rejects every call when there is no secret key", async () => {
  const sink = assistantSink();
  for (const call of [
    () => sink.reserveQuestion(USER),
    () => sink.conversation(USER, CONVERSATION),
    () =>
      sink.startConversation(USER, {
        id: CONVERSATION,
        title: "x",
        unit: "ars",
      }),
    () => sink.history(USER, CONVERSATION, 10),
    () => sink.saveTurn(USER, { conversationId: CONVERSATION, messages: [] }),
  ]) {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssistantStoreError);
    expect(error).toMatchObject({ code: "unconfigured" });
  }
});
