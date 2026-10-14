import "server-only";
import { google } from "@ai-sdk/google";
import type { AiCostInsert, AiCostType, PricedModelId } from "@plant/shared";
import { SourceError } from "@plant/sources";
import {
  APICallError,
  generateText,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
  RetryError,
} from "ai";
import type { z } from "zod";

import { costedModel, type ModelFactory, telemetryOf } from "./costed-model";

// A provider that is down, rate limiting or too slow may answer on a later
// attempt. The SDK wraps what its own retries met in a RetryError.
function retryable(error: unknown): boolean {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  // AbortSignal.timeout rejects with a DOMException, which may not be an Error.
  if ((last as { name?: unknown } | null)?.name === "TimeoutError") return true;
  return APICallError.isInstance(last) ? last.isRetryable : false;
}

// The most a structured answer may run: a full draft of 500 rows fits well
// within it, and a runaway answer stops there instead of costing more.
const MAX_OUTPUT_TOKENS = 32_000;

// One model call that answers in `schema`, costed to the user. A model that
// answers nothing usable fails as unreadable; anything else fails as
// extraction_failed, retryable when the provider may answer later.
export async function structuredCall<T>({
  modelId,
  costType,
  userId,
  record,
  model = (id) => google(id),
  system,
  messages,
  schema,
  timeoutMs,
}: {
  modelId: PricedModelId;
  costType: AiCostType;
  userId: string;
  record: (row: AiCostInsert) => Promise<void>;
  model?: ModelFactory;
  system: string;
  messages: ModelMessage[];
  schema: z.ZodType<T>;
  timeoutMs: number;
}): Promise<T> {
  try {
    const { output } = await generateText({
      model: costedModel({ modelId, model, userId, costType, record }),
      system,
      output: Output.object({ schema }),
      messages,
      maxRetries: 1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(timeoutMs),
      experimental_telemetry: telemetryOf(costType),
    });
    return output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new SourceError("unreadable", false, { cause: error });
    }
    throw new SourceError("extraction_failed", retryable(error), {
      cause: error,
    });
  }
}
