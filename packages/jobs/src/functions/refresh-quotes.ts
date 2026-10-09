import {
  QUOTE_CLOSE_HOUR,
  QuoteError,
  quoteFailureOf,
  type QuoteFeedPort,
  type QuoteStage,
  QuoteStoreError,
  type QuoteStorePort,
  type Refusal,
  REFUSALS,
} from "@plant/core";
import { BUENOS_AIRES_TZ, type LogFields, type Logger } from "@plant/shared";
import { NonRetriableError } from "inngest";

import { inngest } from "../client";

export type QuoteJobDeps = {
  feeds: readonly QuoteFeedPort[];
  store: QuoteStorePort;
  log: Logger;
  now: () => Date;
};

// Every hour from the close until midnight: a later slot fills a slot missed
// while the machine slept, a source down past its retries, or a dollar house
// a day behind. Extra runs insert nothing.
export const REFRESH_QUOTES_CRON = `TZ=${BUENOS_AIRES_TZ} 5 ${QUOTE_CLOSE_HOUR}-23 * * *`;
export const REFRESH_QUOTES_EVENT = "plant/quotes.refresh";

// What a step returns: counts, keys and time only. Quote rows never cross a
// step boundary, because memoized step output is what the caller sends back
// when signatures are off.
type StepOutcome =
  | {
      ok: true;
      fxRates: number;
      prices: number;
      refused: Record<Refusal, string[]>;
      unread: string[];
      ms: number;
    }
  | { ok: false; stage: QuoteStage; code: string; ms?: number };

export type QuoteSteps = {
  run(id: string, fn: () => Promise<StepOutcome>): Promise<StepOutcome>;
};

type RunContext = { step: QuoteSteps; runId: string; attempt: number };

// Reads one feed and saves what it kept, so a retry reads again. A retryable
// failure is thrown for the step to retry; any other ends the step.
async function refreshFeed(
  deps: QuoteJobDeps,
  feed: QuoteFeedPort,
  { runId, attempt }: RunContext,
): Promise<StepOutcome> {
  const start = deps.now();
  const elapsed = () => deps.now().getTime() - start.getTime();
  let stage: QuoteStage = "read";
  try {
    const { fxRates, prices, refused, unread } = await feed.read(start);
    stage = "save";
    const saved =
      fxRates.length + prices.length > 0
        ? await deps.store.save({ fxRates, prices })
        : { fxRates: 0, prices: 0 };
    return { ok: true, ...saved, refused, unread, ms: elapsed() };
  } catch (error) {
    const { code } = quoteFailureOf(error);
    const ms = elapsed();
    const fields = {
      "plant.inngest.run_id": runId,
      "plant.inngest.attempt": attempt,
      "plant.quotes.source": feed.id,
      "plant.quotes.stage": stage,
      "plant.quotes.step_ms": ms,
    };
    if (!(error instanceof QuoteError)) {
      deps.log.error("quotes.feed_failed", fields, error);
      return { ok: false, stage, code, ms };
    }
    deps.log.warn("quotes.feed_failed", {
      ...fields,
      "error.type": code,
      "plant.quotes.store_code":
        error instanceof QuoteStoreError ? error.storeCode : undefined,
    });
    if (error.retryable) throw error;
    return { ok: false, stage, code, ms };
  }
}

const REFUSAL_FIELD = {
  early: "plant.quotes.early_keys",
  closed: "plant.quotes.closed_keys",
  stale: "plant.quotes.stale_keys",
  invalid: "plant.quotes.invalid_keys",
} as const satisfies Record<Refusal, string>;

const list = (values: readonly string[]) =>
  [...new Set(values)].sort().join(",");

type Outcome = "ok" | "stale" | "partial" | "failed";
const LEVEL = {
  ok: "info",
  stale: "warn",
  partial: "warn",
  failed: "error",
} as const satisfies Record<Outcome, keyof Logger>;

// One line per run, after every step: the run's outcome, what it inserted and
// the key of every row it refused.
function runLine(
  runId: string,
  results: readonly { feed: string; outcome: StepOutcome }[],
): { outcome: Outcome; fxRates: number; prices: number; fields: LogFields } {
  const done = results.flatMap(({ outcome }) => (outcome.ok ? [outcome] : []));
  const failed = results.flatMap(({ feed, outcome }) =>
    outcome.ok ? [] : [{ feed, ...outcome }],
  );
  const timed = results.flatMap(({ feed, outcome }) =>
    outcome.ms === undefined ? [] : [{ feed, ms: outcome.ms }],
  );
  const slowest = timed.reduce<(typeof timed)[number] | undefined>(
    (max, entry) => (max && max.ms >= entry.ms ? max : entry),
    undefined,
  );
  const keys = (refusal: Refusal) =>
    done.flatMap(({ refused }) => refused[refusal]);
  const invalidCount = keys("invalid").length;
  const outcome: Outcome =
    failed.length === results.length
      ? "failed"
      : failed.length > 0 || invalidCount > 0
        ? "partial"
        : keys("stale").length > 0
          ? "stale"
          : "ok";
  const [first] = failed;
  const fxRates = done.reduce((sum, step) => sum + step.fxRates, 0);
  const prices = done.reduce((sum, step) => sum + step.prices, 0);
  const fields: Record<string, LogFields[string]> = {
    "plant.inngest.run_id": runId,
    "plant.outcome": outcome,
    "plant.quotes.duration_ms": slowest
      ? timed.reduce((sum, { ms }) => sum + ms, 0)
      : undefined,
    "plant.quotes.slowest_feed": slowest?.feed,
    "plant.quotes.fx_rate_count": fxRates,
    "plant.quotes.price_count": prices,
    "plant.quotes.invalid_count": invalidCount,
    "plant.quotes.unread": list(done.flatMap(({ unread }) => unread)),
    "plant.quotes.failed_codes": list(
      failed.map(({ feed, stage, code }) => `${feed}:${stage}:${code}`),
    ),
    "plant.quotes.stage": first?.stage,
    "error.type": first?.code,
  };
  for (const refusal of REFUSALS) {
    fields[REFUSAL_FIELD[refusal]] = list(keys(refusal));
  }
  return { outcome, fxRates, prices, fields };
}

export async function runRefreshQuotes(
  deps: QuoteJobDeps,
  context: RunContext,
): Promise<{ outcome: Outcome; fxRates: number; prices: number }> {
  const results: { feed: string; outcome: StepOutcome }[] = [];
  for (const feed of deps.feeds) {
    let outcome: StepOutcome;
    try {
      outcome = await context.step.run(`refresh-${feed.id}`, () =>
        refreshFeed(deps, feed, context),
      );
    } catch (error) {
      // The step's retries ran out; each attempt logged its own line.
      outcome = { ok: false, ...quoteFailureOf(error) };
    }
    results.push({ feed: feed.id, outcome });
  }
  const { fields, ...counts } = runLine(context.runId, results);
  deps.log[LEVEL[counts.outcome]]("quotes.refresh", fields);
  if (counts.outcome === "failed") {
    throw new NonRetriableError("quotes.refresh failed");
  }
  return counts;
}

export const refreshQuotes = (deps: QuoteJobDeps) =>
  inngest.createFunction(
    {
      id: "refresh-quotes",
      triggers: [
        { cron: REFRESH_QUOTES_CRON },
        { event: REFRESH_QUOTES_EVENT },
      ],
      singleton: { mode: "skip" },
      retries: 2,
    },
    ({ step, runId, attempt }) =>
      runRefreshQuotes(deps, { step, runId, attempt }),
  );
