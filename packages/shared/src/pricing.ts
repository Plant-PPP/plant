// USD per 1M tokens, Standard tier. Sources (checked 2026-10-08):
// https://ai.google.dev/gemini-api/docs/pricing,
// https://platform.claude.com/docs/en/about-claude/pricing.
// gemini-3.8-flash carries its price from 2027-01-01; until 2026-12-31 Google
// bills 0.75 / 3.75 / 0.075, so its rows before then are over-counted, never
// under-counted. cacheWrite is the 5-minute cache write; "0" means the model
// has no per-token write price. Not priced, so a caller that enables one prices
// it first: 1-hour cache writes, which @ai-sdk/anthropic counts inside
// cacheWrite (prompt caching arrives with PLA-47); audio input, which
// gemini-3.1-flash-lite bills at twice its text rate; and Gemini's per-hour
// cache storage.
type ModelPricing = {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

export const MODEL_PRICING = {
  "gemini-3.5-flash-lite": {
    input: "0.30",
    output: "2.50",
    cacheRead: "0.03",
    cacheWrite: "0",
  },
  "gemini-3.1-flash-lite": {
    input: "0.25",
    output: "1.50",
    cacheRead: "0.025",
    cacheWrite: "0",
  },
  "gemini-3.8-flash": {
    input: "1.50",
    output: "7.50",
    cacheRead: "0.15",
    cacheWrite: "0",
  },
  "claude-haiku-4-5": {
    input: "1.00",
    output: "5.00",
    cacheRead: "0.10",
    cacheWrite: "1.25",
  },
} as const satisfies Record<string, ModelPricing>;

export type PricedModelId = keyof typeof MODEL_PRICING;

// input excludes cache reads and cache writes; output includes reasoning.
export type TokenUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

const SCALE_DIGITS = 8;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const TOKENS_PER_PRICE_UNIT = 1_000_000n;

function toScaled(decimal: string): bigint {
  const [whole = "0", fraction = ""] = decimal.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, "0"));
}

function tokens(count: number): bigint {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("Token counts must be non-negative safe integers");
  }
  return BigInt(count);
}

// Cost in USD as a decimal string, rounded half-up to 8 decimals
// (numeric(20, 8)).
export function costUsd(modelId: PricedModelId, usage: TokenUsage): string {
  const price = MODEL_PRICING[modelId];
  const perMillion =
    toScaled(price.input) * tokens(usage.input) +
    toScaled(price.cacheRead) * tokens(usage.cacheRead) +
    toScaled(price.cacheWrite) * tokens(usage.cacheWrite) +
    toScaled(price.output) * tokens(usage.output);
  const scaled =
    (perMillion + TOKENS_PER_PRICE_UNIT / 2n) / TOKENS_PER_PRICE_UNIT;
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE)
    .toString()
    .padStart(SCALE_DIGITS, "0")
    .replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}
