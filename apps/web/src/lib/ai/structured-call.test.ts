import type { AiCostInsert } from "@plant/shared";
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

beforeEach(() => captureServerLog());

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
