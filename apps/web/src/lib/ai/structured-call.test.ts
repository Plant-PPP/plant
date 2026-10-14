import type { AiCostInsert } from "@plant/shared";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const mockGenerateText = jest.fn();
jest.mock("ai", () => {
  const actual = jest.requireActual("ai");
  return {
    ...actual,
    generateText: (...args: unknown[]) => {
      mockGenerateText(...args);
      return actual.generateText(...args);
    },
  };
});
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@ai-sdk/google", () => ({ google: jest.fn() }));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { structuredCall } from "./structured-call";

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
});

it("traces the call without the document, the prompt or the answer", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 2, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  await structuredCall({
    modelId: "gemini-3.8-flash",
    costType: "import_extraction",
    userId: "u1",
    record: jest.fn<Promise<void>, [AiCostInsert]>(async () => {}),
    model: () => model,
    system: "s",
    messages: [{ role: "user", content: "m" }],
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
  });
  expect(mockGenerateText).toHaveBeenCalledWith(
    expect.objectContaining({
      experimental_telemetry: {
        isEnabled: true,
        functionId: "import_extraction",
        recordInputs: false,
        recordOutputs: false,
      },
    }),
  );
});

it("fails as unreadable without the answer it could not read", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ ok: "SECRET_ROW" }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 2, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  });
  const failed = await structuredCall({
    modelId: "gemini-3.8-flash",
    costType: "import_extraction",
    userId: "u1",
    record: jest.fn<Promise<void>, [AiCostInsert]>(async () => {}),
    model: () => model,
    system: "s",
    messages: [{ role: "user", content: "m" }],
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
  }).catch((error: unknown) => error);
  expect(failed).toMatchObject({ code: "unreadable", retryable: false });
  expect((failed as Error).cause).toBeUndefined();
});

it("logs a provider's refusal by its type and status, never its message", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: () =>
      Promise.reject(
        new APICallError({
          message: "SECRET_MESSAGE",
          url: "https://provider.test",
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        }),
      ),
  });
  const failed = await structuredCall({
    modelId: "gemini-3.8-flash",
    costType: "import_extraction",
    userId: "u1",
    record: jest.fn<Promise<void>, [AiCostInsert]>(async () => {}),
    model: () => model,
    system: "s",
    messages: [{ role: "user", content: "m" }],
    schema: z.object({ ok: z.boolean() }),
    timeoutMs: 1000,
  }).catch((error: unknown) => error);
  expect(failed).toMatchObject({ code: "extraction_failed", retryable: false });
  expect(lines).toEqual([
    {
      level: "warn",
      event: "ai.call_failed",
      "plant.cost_type": "import_extraction",
      "gen_ai.request.model": "gemini-3.8-flash",
      "enduser.id": "u1",
      "error.type": "AI_APICallError",
      "http.response.status_code": 401,
    },
  ]);
  expect(JSON.stringify(lines)).not.toContain("SECRET_MESSAGE");
});
