import "server-only";
import { google } from "@ai-sdk/google";
import type { AiCostInsert, AiCostType, PricedModelId } from "@plant/shared";
import { SourceError } from "@plant/sources";
import {
  APICallError,
  generateText,
  type LanguageModel,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
  RetryError,
  wrapLanguageModel,
} from "ai";
import type { z } from "zod";

import { costMiddleware } from "./cost-middleware";

// A provider that is down or rate limiting may answer on a later attempt. The
// SDK wraps what its own retries met in a RetryError.
function retryable(error: unknown): boolean {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(last) ? last.isRetryable : false;
}

export type ModelFactory = (id: PricedModelId) => LanguageModel;

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
  const wrapped = wrapLanguageModel({
    model: model(modelId) as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: costMiddleware({
      modelId,
      context: { userId, costType },
      record,
    }),
  });
  try {
    const { output } = await generateText({
      model: wrapped,
      system,
      output: Output.object({ schema }),
      messages,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(timeoutMs),
      // gen_ai spans through the app's OpenTelemetry setup, without the
      // document, the prompt or the answer.
      experimental_telemetry: {
        isEnabled: true,
        functionId: costType,
        recordInputs: false,
        recordOutputs: false,
      },
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
