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

type UnbilledReason = "aborted" | "call_error" | "no_finish" | "stream_error";

function tokenUsage({ inputTokens, outputTokens }: ProviderUsage): TokenUsage {
  const cacheRead = inputTokens.cacheRead ?? 0;
  const cacheWrite = inputTokens.cacheWrite ?? 0;
  return {
    input:
      inputTokens.noCache ??
      Math.max(0, (inputTokens.total ?? 0) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: outputTokens.total ?? 0,
  };
}

// Writes one ai_costs row per model call, priced by the requested model.
// Recording never throws into the call: a failure is logged, and so is a call
// the provider may have billed without a row.
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
    else if (
      !APICallError.isInstance(error) ||
      error.statusCode === undefined ||
      error.statusCode < 400
    ) {
      unbilled("call_error", error);
    }
  }

  async function safeRecord(usage: ProviderUsage, errorSeen: boolean) {
    try {
      if (
        usage.inputTokens.total === undefined ||
        usage.outputTokens.total === undefined
      ) {
        serverLog.warn("ai_cost.usage_missing", {
          ...fields,
          "plant.ai_cost.reason": errorSeen ? "provider_error" : "no_usage",
        });
      }
      await record(aiCostRow(modelId, context, tokenUsage(usage)));
    } catch (error) {
      // A timed-out insert may still have committed.
      const timedOut =
        error instanceof AiCostWriteError && error.message === "timeout";
      serverLog.error(
        "ai_cost.record_failed",
        {
          ...fields,
          "plant.ai_cost.reason": timedOut ? "unknown" : "not_written",
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
      await safeRecord(result.usage, false);
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
      let errorSeen = false;
      // The DOM lib's Transformer lacks cancel, which runs when the model
      // stream errors or is aborted.
      const transformer: Transformer<StreamPart, StreamPart> & {
        cancel?: (reason: unknown) => void;
      } = {
        async transform(part, controller) {
          if (part.type === "error") errorSeen = true;
          if (part.type === "finish") {
            finished = true;
            // The step finishes only once its cost is recorded.
            await safeRecord(part.usage, errorSeen);
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
