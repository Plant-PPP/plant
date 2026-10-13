import "server-only";
import type { AiCostInsert, AiCostType, PricedModelId } from "@plant/shared";
import { type LanguageModel, wrapLanguageModel } from "ai";

import { costMiddleware } from "./cost-middleware";

export type ModelFactory = (id: PricedModelId) => LanguageModel;

// A model whose every call writes its cost row for the user. Built per
// request, never shared across users.
export function costedModel({
  modelId,
  model,
  userId,
  costType,
  record,
}: {
  modelId: PricedModelId;
  model: ModelFactory;
  userId: string;
  costType: AiCostType;
  record: (row: AiCostInsert) => Promise<void>;
}) {
  return wrapLanguageModel({
    model: model(modelId) as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: costMiddleware({
      modelId,
      context: { userId, costType },
      record,
    }),
  });
}

// gen_ai spans through the app's OpenTelemetry setup, without the prompt or
// the answer.
export const telemetryOf = (functionId: AiCostType) => ({
  isEnabled: true,
  functionId,
  recordInputs: false,
  recordOutputs: false,
});
