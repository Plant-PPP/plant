import type { HistoricalFxRate } from "@plant/core";
import type { Logger } from "@plant/shared";

import { BACKFILL_CHUNK, runBackfillFxRates } from "./backfill-fx-rates";

// Made up, in ArgentinaDatos' shape: 1500 days of one house.
const series = Array.from({ length: 1500 }, (_, day) => ({
  casa: "bolsa",
  compra: 1000,
  venta: 1010,
  fecha: new Date(Date.UTC(2022, 0, 1 + day)).toISOString().slice(0, 10),
}));

const log = () => {
  const lines: { level: string; event: string; fields: unknown }[] = [];
  const at =
    (level: string) =>
    (event: string, fields: unknown): void => {
      lines.push({ level, event, fields });
    };
  return {
    lines,
    logger: {
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
    } as unknown as Logger,
  };
};

const step = {
  run: (_: string, fn: () => Promise<{ read: number; inserted: number }>) =>
    fn(),
};

it("saves the three dollars' past days a chunk at a time and logs counts only", async () => {
  const saved: number[] = [];
  const { lines, logger } = log();
  const counts = await runBackfillFxRates(
    {
      getJson: async () => series,
      store: {
        backfill: async (rows: readonly HistoricalFxRate[]) => {
          saved.push(rows.length);
          return rows.length - 1;
        },
      },
      log: logger,
      now: () => new Date("2026-10-19T12:00:00Z"),
    },
    { step, runId: "r1" },
  );
  expect(saved.every((size) => size <= BACKFILL_CHUNK)).toBe(true);
  expect(saved.reduce((a, b) => a + b, 0)).toBe(4500);
  expect(counts).toEqual({ read: 4500, inserted: 4500 - saved.length });
  expect(lines).toEqual([
    {
      level: "info",
      event: "quotes.fx_backfill",
      fields: {
        "plant.inngest.run_id": "r1",
        "plant.outcome": "ok",
        "plant.count": 4500 - saved.length,
        "plant.quotes.read_count": 4500,
      },
    },
  ]);
});

it("logs a failure and throws it for Inngest to retry", async () => {
  const { lines, logger } = log();
  await expect(
    runBackfillFxRates(
      {
        getJson: async () => {
          throw new Error("down");
        },
        store: { backfill: async () => 0 },
        log: logger,
        now: () => new Date("2026-10-19T12:00:00Z"),
      },
      { step, runId: "r1" },
    ),
  ).rejects.toThrow("down");
  expect(lines.map(({ level }) => level)).toEqual(["error"]);
});
