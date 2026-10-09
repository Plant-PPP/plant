import type { Database } from "./db/generated/database.types";
import { costUsd, type PricedModelId, type TokenUsage } from "./pricing";

type Insert = Database["public"]["Tables"]["ai_costs"]["Insert"];

export type AiCostType = Database["public"]["Enums"]["ai_cost_type"];

/**
 * Who a model call is billed to. `userId` comes from the authenticated session
 * or from a row the server loaded (an import's `user_id`), never from a request
 * body, an event payload or model output: the cost writer bypasses RLS.
 */
export type AiCostContext = { userId: string; costType: AiCostType };

// Exactly the columns the service role may insert. The type generator maps
// numeric to number; amounts travel as decimal strings.
export type AiCostInsert = Pick<
  Insert,
  | "user_id"
  | "cost_type"
  | "model_id"
  | "input_tokens"
  | "cache_read_tokens"
  | "cache_write_tokens"
  | "output_tokens"
> & { amount_usd: string };

export function aiCostRow(
  modelId: PricedModelId,
  context: AiCostContext,
  usage: TokenUsage,
): AiCostInsert {
  return {
    user_id: context.userId,
    cost_type: context.costType,
    model_id: modelId,
    amount_usd: costUsd(modelId, usage),
    input_tokens: usage.input,
    cache_read_tokens: usage.cacheRead,
    cache_write_tokens: usage.cacheWrite,
    output_tokens: usage.output,
  };
}
