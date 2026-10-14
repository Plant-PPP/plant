jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/deployment", () => ({ isProductionDeployment: () => true }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({
    sub: "a0000000-0000-4000-8000-00000000000a",
  }),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { POST } from "./route";

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
