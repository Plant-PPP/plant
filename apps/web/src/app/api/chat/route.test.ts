jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/deployment", () => ({ isProductionDeployment: () => true }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({
    sub: "a0000000-0000-4000-8000-00000000000a",
  }),
}));

const runAssistantTurn = jest.fn();
jest.mock("@/lib/ai/assistant/turn", () => ({
  ...jest.requireActual("@/lib/ai/assistant/turn"),
  runAssistantTurn: (...args: unknown[]) => runAssistantTurn(...args),
}));
const consents = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (value: unknown) => unknown) => resolve(consents()),
    };
    return { from: () => builder };
  },
}));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { CONSENT_VERSION } from "@/lib/consent";

import { POST } from "./route";

const question = () =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: "a8000000-0000-4000-8000-0000000000a8",
      unit: "ars",
      message: { parts: [{ type: "text", text: "¿Cuánto tengo?" }] },
    }),
  });

beforeEach(() => runAssistantTurn.mockReset());

it("answers a body the client aborted midway as a bad request, never an error", async () => {
  const lines = captureServerLog();
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) controller.error(new Error("aborted"));
      else {
        sent = true;
        controller.enqueue(new TextEncoder().encode('{"conversationId"'));
      }
    },
  });
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit),
  );
  expect(response.status).toBe(400);
  expect(lines).toEqual([
    expect.objectContaining({
      event: "assistant.turn",
      level: "warn",
      "plant.outcome": "aborted",
    }),
  ]);
});

it("answers a user who has not accepted the terms and the AI providers without asking the model", async () => {
  const lines = captureServerLog();
  consents.mockReturnValue({ status: 200, data: [], error: null });
  const response = await POST(question());
  expect(response.status).toBe(403);
  expect(await response.text()).toMatch(/aceptá los términos en Cargar/);
  expect(runAssistantTurn).not.toHaveBeenCalled();
  expect(lines).toEqual([
    expect.objectContaining({
      event: "assistant.turn",
      "plant.outcome": "consent",
      "http.response.status_code": 403,
    }),
  ]);
});

it("asks the model once the user accepted the terms and the AI providers", async () => {
  consents.mockReturnValue({
    status: 200,
    data: [{ version: CONSENT_VERSION, granted: true }],
    error: null,
  });
  runAssistantTurn.mockResolvedValue(new Response("respuesta"));
  const response = await POST(question());
  expect(response.status).toBe(200);
  expect(runAssistantTurn).toHaveBeenCalledTimes(1);
});
