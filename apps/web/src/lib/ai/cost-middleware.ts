import {
  aiCostRow,
  type AiCostContext,
  type AiCostInsert,
  type PricedModelId,
  type TokenUsage,
} from "@plant/shared";
import { APICallError, type LanguageModelMiddleware } from "ai";
import { errorType, serverLog } from "@/lib/log/server-log";
import { AiCostWriteError } from "./ai-cost-writer";

type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;
type WrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type CallParams = Parameters<WrapGenerate>[0]["params"];
// ai does not export the provider usage type; derive it rather than pin
// @ai-sdk/provider.
type ProviderUsage = Awaited<
  ReturnType<Parameters<WrapGenerate>[0]["doGenerate"]>
>["usage"];
type StreamPart =
  Awaited<
    ReturnType<Parameters<WrapStream>[0]["doStream"]>
  >["stream"] extends ReadableStream<infer P>
    ? P
    : never;

type UnbilledReason =
  "aborted" | "call_error" | "no_finish" | "stream_error" | "usage_missing";

// Without both totals there is nothing to price: a missing count is not 0.
function tokenUsage({
  inputTokens,
  outputTokens,
}: ProviderUsage): TokenUsage | undefined {
  const input = inputTokens.total;
  const output = outputTokens.total;
  if (input === undefined || output === undefined) return undefined;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  const cacheRead = inputTokens.cacheRead ?? 0;
  const cacheWrite = inputTokens.cacheWrite ?? 0;
  return {
    input: inputTokens.noCache ?? Math.max(0, input - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output,
  };
}

// Only a provider's own error status shows it refused the call. The AI
// Gateway's errors carry made-up ones too (408 for its own timeout, 500 for a
// lost connection), so they count as calls that may have billed.
function providerRefused(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    error.statusCode !== undefined &&
    error.statusCode >= 400
  );
}

// Writes one ai_costs row per model call, priced by the requested model.
// Recording never throws into the call; a row that may be missing is logged.
// `record` must settle (createAiCostWriter gives up after 1.5 s), and a step
// finishes only once its row is recorded, so a caller's step or chunk timeout
// must leave room for it.
export function costMiddleware(options: {
  modelId: PricedModelId;
  context: AiCostContext;
  record: (row: AiCostInsert) => Promise<void>;
}): LanguageModelMiddleware {
  const { modelId, context, record } = options;
  const fields = {
    "plant.cost_type": context.costType,
    "gen_ai.request.model": modelId,
    "enduser.id": context.userId,
  };

  function unbilled(reason: UnbilledReason, error?: unknown) {
    serverLog.warn("ai_cost.unbilled", {
      ...fields,
      "plant.ai_cost.reason": reason,
      "error.type": error instanceof Error ? errorType(error) : undefined,
    });
  }

  // The SDK retries each attempt through the middleware. A provider that
  // answered with an error status did not bill it; the caller logs the final
  // failure.
  function callFailed(params: CallParams, error: unknown) {
    if (params.abortSignal?.aborted) unbilled("aborted", error);
    else if (!providerRefused(error)) unbilled("call_error", error);
  }

  async function safeRecord(usage: ProviderUsage) {
    try {
      const tokens = tokenUsage(usage);
      if (!tokens) {
        unbilled("usage_missing");
        return;
      }
      await record(aiCostRow(modelId, context, tokens));
    } catch (error) {
      const unknown =
        error instanceof AiCostWriteError && error.mayHaveCommitted;
      serverLog.error(
        "ai_cost.record_failed",
        {
          ...fields,
          "plant.ai_cost.reason": unknown ? "unknown" : "not_written",
        },
        error,
      );
    }
  }

  return {
    specificationVersion: "v3",

    async wrapGenerate({ doGenerate, params }) {
      let result;
      try {
        result = await doGenerate();
      } catch (error) {
        callFailed(params, error);
        throw error;
      }
      await safeRecord(result.usage);
      return result;
    },

    async wrapStream({ doStream, params }) {
      let result;
      try {
        result = await doStream();
      } catch (error) {
        callFailed(params, error);
        throw error;
      }
      let finished = false;
      // The DOM lib's Transformer lacks cancel, which runs when the model
      // stream errors or either side is cancelled.
      const transformer: Transformer<StreamPart, StreamPart> & {
        cancel?: (reason: unknown) => void;
      } = {
        async transform(part, controller) {
          if (part.type === "finish") {
            finished = true;
            await safeRecord(part.usage);
          }
          controller.enqueue(part);
        },
        flush() {
          if (!finished) unbilled("no_finish");
        },
        cancel(reason) {
          if (finished) return;
          unbilled(
            params.abortSignal?.aborted ? "aborted" : "stream_error",
            reason,
          );
        },
      };
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream(transformer)),
      };
    },
  };
}
