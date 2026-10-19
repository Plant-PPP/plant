import {
  type GetJson,
  type HistoricalFxRate,
  readDollarHistory,
} from "@plant/core";
import { BUENOS_AIRES_TZ, type Logger } from "@plant/shared";

import { inngest } from "../client";

// Where the job saves past dollar rates: the composition root implements it
// with the service role, which inserts the days fx_rates lacks and returns
// how many it inserted.
export interface FxHistoryStorePort {
  backfill(rows: readonly HistoricalFxRate[]): Promise<number>;
}

export type FxBackfillJobDeps = {
  getJson: GetJson;
  store: FxHistoryStorePort;
  log: Logger;
  now: () => Date;
};

// Once a day, before the quotes job: yesterday's close is in ArgentinaDatos'
// series by then, and a day the hourly job missed is filled.
export const BACKFILL_FX_RATES_CRON = `TZ=${BUENOS_AIRES_TZ} 40 6 * * *`;
const BACKFILL_FX_RATES_EVENT = "plant/quotes.fx_backfill";
export const BACKFILL_CHUNK = 1000;

export type FxBackfillSteps = {
  run(
    id: string,
    fn: () => Promise<{ read: number; inserted: number }>,
  ): Promise<{ read: number; inserted: number }>;
};

// Reads the three series and saves them a chunk at a time in one step, so
// rate rows never cross a step boundary; a failure is logged and thrown for
// Inngest to retry, which reads again.
export async function runBackfillFxRates(
  deps: FxBackfillJobDeps,
  { step, runId }: { step: FxBackfillSteps; runId: string },
): Promise<{ read: number; inserted: number }> {
  try {
    const counts = await step.run("backfill", async () => {
      const rows = await readDollarHistory(deps.getJson, deps.now());
      let inserted = 0;
      for (let at = 0; at < rows.length; at += BACKFILL_CHUNK) {
        inserted += await deps.store.backfill(
          rows.slice(at, at + BACKFILL_CHUNK),
        );
      }
      return { read: rows.length, inserted };
    });
    deps.log.info("quotes.fx_backfill", {
      "plant.inngest.run_id": runId,
      "plant.outcome": "ok",
      "plant.count": counts.inserted,
      "plant.quotes.read_count": counts.read,
    });
    return counts;
  } catch (error) {
    deps.log.error(
      "quotes.fx_backfill",
      { "plant.inngest.run_id": runId, "plant.outcome": "failed" },
      error,
    );
    throw error;
  }
}

export const backfillFxRates = (deps: FxBackfillJobDeps) =>
  inngest.createFunction(
    {
      id: "backfill-fx-rates",
      triggers: [
        { cron: BACKFILL_FX_RATES_CRON },
        { event: BACKFILL_FX_RATES_EVENT },
      ],
      singleton: { mode: "skip" },
      retries: 2,
    },
    ({ step, runId }) => runBackfillFxRates(deps, { step, runId }),
  );
