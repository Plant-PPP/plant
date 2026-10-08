import type { AiCostInsert } from "@plant/shared";
import {
  APICallError,
  generateText,
  type LanguageModelMiddleware,
  stepCountIs,
  streamText,
  tool,
  wrapLanguageModel,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

jest.mock("server-only", () => ({}), { virtual: true });

import { AiCostWriteError } from "./ai-cost-writer";
import { costMiddleware } from "./cost-middleware";

type Wrap = Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0];
type GenerateResult = Awaited<ReturnType<Wrap["doGenerate"]>>;
type StreamResult = Awaited<ReturnType<Wrap["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer P> ? P : never;
type DoGenerate = (options: Wrap["params"]) => PromiseLike<GenerateResult>;
type DoStream = (options: Wrap["params"]) => PromiseLike<StreamResult>;
type Mock = ConstructorParameters<typeof MockLanguageModelV3>[0] & {};

const USER_ID = "a0000000-0000-4000-8000-00000000000a";
const FIELDS = {
  "plant.cost_type": "import_extraction",
  "gen_ai.request.model": "gemini-3.5-flash-lite",
  "enduser.id": USER_ID,
};

function usage(input: number | undefined, output: number | undefined) {
  return {
    inputTokens: {
      total: input,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: output, text: undefined, reasoning: undefined },
  };
}

const USAGE = usage(10_000, 2_280);
const STOP = { unified: "stop", raw: undefined } as const;

const TEXT: GenerateResult = {
  content: [{ type: "text", text: "ok" }],
  finishReason: STOP,
  usage: USAGE,
  warnings: [],
};

const ROW: AiCostInsert = {
  user_id: USER_ID,
  cost_type: "import_extraction",
  model_id: "gemini-3.5-flash-lite",
  amount_usd: "0.0087",
  input_tokens: 10_000,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  output_tokens: 2_280,
};

let record: jest.Mock<Promise<void>, [AiCostInsert]>;
let lines: Record<string, unknown>[];

beforeEach(() => {
  record = jest.fn<Promise<void>, [AiCostInsert]>(async () => {});
  lines = [];
  jest.spyOn(console, "log").mockImplementation(collect);
  jest.spyOn(console, "warn").mockImplementation(collect);
  jest.spyOn(console, "error").mockImplementation(collect);
});

// serverLog's lines; the SDK's own warnings are not JSON.
function collect(line?: unknown) {
  if (typeof line === "string" && line.startsWith("{")) {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

function model(mock: Mock) {
  return wrapLanguageModel({
    model: new MockLanguageModelV3(mock),
    middleware: costMiddleware({
      modelId: "gemini-3.5-flash-lite",
      context: { userId: USER_ID, costType: "import_extraction" },
      record,
    }),
  });
}

function events() {
  return lines.map((line) => [line.event, line["plant.ai_cost.reason"]]);
}

function streamOf(parts: StreamPart[]) {
  return new ReadableStream<StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

const TEXT_PARTS: StreamPart[] = [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "1" },
  { type: "text-delta", id: "1", delta: "ok" },
  { type: "text-end", id: "1" },
];
const FINISH: StreamPart = { type: "finish", usage: USAGE, finishReason: STOP };

// Rejects when the signal aborts, like a fetch.
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

function started() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

// A model call that hangs until its signal aborts.
function hangsUntilAborted(): DoGenerate {
  return ({ abortSignal }) => untilAborted(abortSignal);
}

// A stream that starts, then errors when its signal aborts.
function streamsUntilAborted(): DoStream {
  return async ({ abortSignal }) => ({
    stream: new ReadableStream<StreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        abortSignal?.addEventListener("abort", () =>
          controller.error(abortSignal.reason),
        );
      },
    }),
  });
}

describe("generate", () => {
  it("writes one row with the exact amount", async () => {
    await generateText({ model: model({ doGenerate: TEXT }), prompt: "hi" });
    expect(record.mock.calls).toEqual([[ROW]]);
    expect(lines).toEqual([]);
  });

  it.each([
    ["the uncached count", 10_000],
    ["the total less the cached", undefined],
  ])("bills cache reads apart, from %s", async (_, noCache) => {
    const cached = {
      ...USAGE,
      inputTokens: {
        total: 12_000,
        noCache,
        cacheRead: 2_000,
        cacheWrite: undefined,
      },
    };
    await generateText({
      model: model({ doGenerate: { ...TEXT, usage: cached } }),
      prompt: "hi",
    });
    expect(record.mock.calls).toEqual([
      [{ ...ROW, amount_usd: "0.00876", cache_read_tokens: 2_000 }],
    ]);
  });

  it("writes one row per step", async () => {
    const toolCall: GenerateResult = {
      ...TEXT,
      content: [
        {
          type: "tool-call",
          toolCallId: "1",
          toolName: "lookup",
          input: "{}",
        },
      ],
      finishReason: { unified: "tool-calls", raw: undefined },
    };
    await generateText({
      model: model({ doGenerate: [toolCall, TEXT] }),
      tools: {
        lookup: tool({ inputSchema: z.object({}), execute: async () => "x" }),
      },
      stopWhen: stepCountIs(2),
      prompt: "hi",
    });
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("logs nothing for retried provider refusals", async () => {
    const refusal = () =>
      new APICallError({
        message: "Service Unavailable",
        url: "https://provider.test",
        requestBodyValues: {},
        statusCode: 503,
        responseHeaders: { "retry-after-ms": "1" },
        isRetryable: true,
      });
    const doGenerate = jest
      .fn()
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce(refusal())
      .mockResolvedValueOnce(TEXT);
    await generateText({ model: model({ doGenerate }), prompt: "hi" });
    expect(doGenerate).toHaveBeenCalledTimes(3);
    expect(record.mock.calls).toEqual([[ROW]]);
    expect(lines).toEqual([]);
  });

  it("logs a call that failed after the provider answered", async () => {
    const error = new APICallError({
      message: "Invalid JSON response",
      url: "https://provider.test",
      requestBodyValues: {},
      statusCode: 200,
      isRetryable: false,
    });
    await expect(
      generateText({
        model: model({ doGenerate: () => Promise.reject(error) }),
        prompt: "hi",
      }),
    ).rejects.toThrow("Invalid JSON response");
    expect(record).not.toHaveBeenCalled();
    expect(lines).toEqual([
      {
        ...FIELDS,
        "plant.ai_cost.reason": "call_error",
        "error.type": "AI_APICallError",
        level: "warn",
        event: "ai_cost.unbilled",
      },
    ]);
  });

  it.each([
    ["abort()", (c: AbortController) => c.abort()],
    ["abort(error)", (c: AbortController) => c.abort(new Error("stop"))],
  ])("logs an aborted call after %s", async (_, abort) => {
    const controller = new AbortController();
    const call = generateText({
      model: model({ doGenerate: hangsUntilAborted() }),
      prompt: "hi",
      abortSignal: controller.signal,
    });
    await started();
    abort(controller);
    await expect(call).rejects.toBeDefined();
    expect(events()).toEqual([["ai_cost.unbilled", "aborted"]]);
  });

  it("logs a call that hit its step timeout as aborted", async () => {
    await expect(
      generateText({
        model: model({ doGenerate: hangsUntilAborted() }),
        prompt: "hi",
        timeout: { stepMs: 10 },
      }),
    ).rejects.toBeDefined();
    expect(events()).toEqual([["ai_cost.unbilled", "aborted"]]);
  });

  it("resolves the call and logs when the row is not written", async () => {
    record.mockRejectedValue(new AiCostWriteError("timeout"));
    const result = await generateText({
      model: model({ doGenerate: TEXT }),
      prompt: "hi",
    });
    expect(result.text).toBe("ok");
    expect(lines).toEqual([
      {
        ...FIELDS,
        "plant.ai_cost.reason": "unknown",
        "error.type": "AiCostWriteError",
        "exception.type": "AiCostWriteError",
        "exception.message": "timeout",
        "exception.stacktrace": expect.any(String),
        level: "error",
        event: "ai_cost.record_failed",
      },
    ]);
  });

  it("logs a usage it cannot price instead of failing the call", async () => {
    await generateText({
      model: model({ doGenerate: { ...TEXT, usage: usage(10.5, 1) } }),
      prompt: "hi",
    });
    expect(record).not.toHaveBeenCalled();
    expect(lines).toEqual([
      expect.objectContaining({
        event: "ai_cost.record_failed",
        "plant.ai_cost.reason": "not_written",
        "exception.type": "RangeError",
      }),
    ]);
  });

  it("writes a zero row and logs a missing usage", async () => {
    await generateText({
      model: model({
        doGenerate: { ...TEXT, usage: usage(undefined, undefined) },
      }),
      prompt: "hi",
    });
    expect(record.mock.calls).toEqual([
      [
        {
          ...ROW,
          amount_usd: "0",
          input_tokens: 0,
          output_tokens: 0,
        },
      ],
    ]);
    expect(lines).toEqual([
      {
        ...FIELDS,
        "plant.ai_cost.reason": "no_usage",
        level: "warn",
        event: "ai_cost.usage_missing",
      },
    ]);
  });
});

describe("stream", () => {
  it("writes one row before the step finishes", async () => {
    const order: string[] = [];
    record.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("recorded");
    });
    const result = streamText({
      model: model({
        doStream: async () => ({ stream: streamOf([...TEXT_PARTS, FINISH]) }),
      }),
      prompt: "hi",
      onStepFinish: () => {
        order.push("step-finish");
      },
    });
    expect(await result.text).toBe("ok");
    expect(record.mock.calls).toEqual([[ROW]]);
    expect(order).toEqual(["recorded", "step-finish"]);
    expect(lines).toEqual([]);
  });

  it("writes the row when the consumer stops reading", async () => {
    let finish!: () => void;
    const stream = new ReadableStream<StreamPart>({
      start(controller) {
        for (const part of TEXT_PARTS) controller.enqueue(part);
        finish = () => {
          controller.enqueue(FINISH);
          controller.close();
        };
      },
    });
    const result = streamText({
      model: model({ doStream: async () => ({ stream }) }),
      prompt: "hi",
    });
    const reader = result.textStream.getReader();
    await reader.read();
    await reader.cancel();
    finish();
    await result.consumeStream();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(record.mock.calls).toEqual([[ROW]]);
  });

  it.each([
    ["abort()", (c: AbortController) => c.abort()],
    ["abort(error)", (c: AbortController) => c.abort(new Error("stop"))],
  ])("logs a stream aborted with %s", async (_, abort) => {
    const controller = new AbortController();
    const result = streamText({
      model: model({ doStream: streamsUntilAborted() }),
      prompt: "hi",
      abortSignal: controller.signal,
      onError: () => {},
    });
    const done = result.consumeStream({ onError: () => {} });
    await started();
    abort(controller);
    await done;
    expect(record).not.toHaveBeenCalled();
    expect(events()).toEqual([["ai_cost.unbilled", "aborted"]]);
  });

  it("logs a stream that hit its step timeout as aborted", async () => {
    const result = streamText({
      model: model({ doStream: streamsUntilAborted() }),
      prompt: "hi",
      timeout: { stepMs: 10 },
      onError: () => {},
    });
    await result.consumeStream({ onError: () => {} });
    expect(record).not.toHaveBeenCalled();
    expect(events()).toEqual([["ai_cost.unbilled", "aborted"]]);
  });

  it("logs a stream aborted before it started", async () => {
    const controller = new AbortController();
    const result = streamText({
      model: model({
        doStream: ({ abortSignal }) => untilAborted(abortSignal),
      }),
      prompt: "hi",
      abortSignal: controller.signal,
      onError: () => {},
    });
    const done = result.consumeStream({ onError: () => {} });
    await started();
    controller.abort();
    await done;
    expect(events()).toEqual([["ai_cost.unbilled", "aborted"]]);
  });

  it("logs a stream that errors before it finishes", async () => {
    const stream = new ReadableStream<StreamPart>({
      start(controller) {
        for (const part of TEXT_PARTS) controller.enqueue(part);
        controller.error(new TypeError("terminated"));
      },
    });
    const result = streamText({
      model: model({ doStream: async () => ({ stream }) }),
      prompt: "hi",
      onError: () => {},
    });
    await result.consumeStream({ onError: () => {} });
    expect(record).not.toHaveBeenCalled();
    expect(lines).toEqual([
      {
        ...FIELDS,
        "plant.ai_cost.reason": "stream_error",
        "error.type": "TypeError",
        level: "warn",
        event: "ai_cost.unbilled",
      },
    ]);
  });

  it("logs a stream that closes without finishing and writes nothing", async () => {
    const result = streamText({
      model: model({
        doStream: async () => ({ stream: streamOf(TEXT_PARTS) }),
      }),
      prompt: "hi",
      onError: () => {},
    });
    await result.consumeStream({ onError: () => {} });
    expect(record).not.toHaveBeenCalled();
    expect(events()).toEqual([["ai_cost.unbilled", "no_finish"]]);
  });

  it("flags a usage missing after a provider error part", async () => {
    const result = streamText({
      model: model({
        doStream: async () => ({
          stream: streamOf([
            ...TEXT_PARTS,
            { type: "error", error: new Error("overloaded") },
            { ...FINISH, usage: usage(undefined, undefined) },
          ]),
        }),
      }),
      prompt: "hi",
      onError: () => {},
    });
    await result.consumeStream({ onError: () => {} });
    expect(record).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([["ai_cost.usage_missing", "provider_error"]]);
  });
});
