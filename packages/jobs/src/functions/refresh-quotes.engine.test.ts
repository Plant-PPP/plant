import type {
  FxRate,
  QuoteBatch,
  QuoteFeedPort,
  QuoteStorePort,
} from "@plant/core";
import { Constants, type LogFields } from "@plant/shared";
import { serve } from "inngest/edge";

import { loadWithEnv, restoreEnv } from "../testing";
import type { QuoteJobDeps } from "./refresh-quotes";

// Drives refresh-quotes through the SDK's own request handler, the way the
// dev server does: each request carries the steps memoized so far and the
// attempt, and the handler answers with the next operation.

const [DOLLARS, INDEX, CRYPTO] = Constants.public.Enums.quote_source;
const MAX_ATTEMPTS = 3;
const TODAY = "2026-10-09";

const fxRate = (kind: FxRate["kind"]): FxRate => ({
  kind,
  rate_date: TODAY,
  buy: kind === "uva" ? null : "1",
  sell: "2",
  source: DOLLARS,
  quoted_at: "2026-10-09T21:00:00.000Z",
  fetched_at: "2026-10-09T21:05:00.000Z",
});
const batch = (fxRates: FxRate[]): QuoteBatch => ({
  fxRates,
  prices: [],
  refused: { early: [], closed: [], stale: [], invalid: [] },
  unread: [],
});

type Core = typeof import("@plant/core");
type Line = { level: string; event: string; fields: LogFields };

// The job and core load together under NODE_ENV=development, so the errors
// the fakes throw are the classes the job checks.
function harness(
  build: (core: Core) => {
    feeds: QuoteFeedPort[];
    store: QuoteStorePort;
  },
) {
  const lines: Line[] = [];
  let tick = Date.parse("2026-10-09T21:05:00.000Z");
  const log: QuoteJobDeps["log"] = {
    info: (event, fields = {}) => lines.push({ level: "info", event, fields }),
    warn: (event, fields = {}) => lines.push({ level: "warn", event, fields }),
    error: (event, fields = {}) =>
      lines.push({ level: "error", event, fields }),
  };
  const options = loadWithEnv({ NODE_ENV: "development" }, () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { createServeOptions } =
      require("../index") as typeof import("../index");
    const core = require("@plant/core") as Core;
    /* eslint-enable @typescript-eslint/no-require-imports */
    return createServeOptions({
      quotes: () => ({
        ...build(core),
        log,
        now: () => new Date((tick += 10)),
      }),
    });
  });
  return { lines, options, handler: serve(options) };
}

type Op = {
  op: string;
  id: string;
  name?: string;
  displayName?: string;
  data?: unknown;
  error?: { name: string; message: string };
};
type Memo = Record<
  string,
  { type: "data"; data: unknown } | { type: "error"; error: unknown }
>;

async function call(
  handler: (req: Request) => Promise<Response>,
  steps: Memo,
  attempt: number,
) {
  const body = JSON.stringify({
    version: 2,
    event: { name: "plant/quotes.refresh", data: {} },
    events: [{ name: "plant/quotes.refresh", data: {} }],
    steps,
    ctx: {
      run_id: "01M8Z3K4567890QWERTYXABCDE",
      attempt,
      max_attempts: MAX_ATTEMPTS,
      disable_immediate_execution: false,
      use_api: false,
      stack: { stack: Object.keys(steps), current: Object.keys(steps).length },
    },
  });
  const response = await handler(
    new Request(
      "http://127.0.0.1:3000/api/inngest?fnId=plant-refresh-quotes&stepId=step",
      {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1" },
        body,
      },
    ),
  );
  const text = await response.text();
  return {
    status: response.status,
    noRetry: response.headers.get("x-inngest-no-retry"),
    body: text ? (JSON.parse(text) as unknown) : undefined,
  };
}

// The executor's loop: memoize each step's data, retry a step's error with
// the attempt raised, and memoize the error the SDK marks final.
async function run(handler: (req: Request) => Promise<Response>) {
  const steps: Memo = {};
  let attempt = 0;
  const trace: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const answer = await call(handler, steps, attempt);
    if (answer.status !== 206) return { answer, trace };
    for (const op of answer.body as Op[]) {
      trace.push(`${op.op}:${op.displayName ?? op.name ?? op.id}`);
      if (op.op === "StepRun") {
        steps[op.id] = { type: "data", data: op.data ?? null };
        attempt = 0;
      } else if (op.op === "StepError") {
        attempt += 1;
      } else if (op.op === "StepFailed") {
        steps[op.id] = { type: "error", error: op.error };
        attempt = 0;
      } else {
        throw new Error(`unexpected op ${op.op}`);
      }
    }
  }
  throw new Error("the run never finished");
}

const runLines = (lines: Line[]) =>
  lines.filter((line) => line.event === "quotes.refresh");
const feedLines = (lines: Line[]) =>
  lines.filter((line) => line.event === "quotes.feed_failed");

afterEach(restoreEnv);

describe("refresh-quotes under the SDK's executor", () => {
  it("memoizes each step and saves each feed once", async () => {
    const save = jest.fn(async ({ fxRates }: { fxRates: FxRate[] }) => ({
      fxRates: fxRates.length,
      prices: 0,
    }));
    const { lines, handler } = harness(() => ({
      feeds: [
        { id: DOLLARS, read: async () => batch([fxRate("mep")]) },
        { id: INDEX, read: async () => batch([fxRate("uva")]) },
      ],
      store: { save },
    }));
    const { answer, trace } = await run(handler);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ outcome: "ok", fxRates: 2, prices: 0 });
    expect(trace).toEqual([
      `StepRun:refresh-${DOLLARS}`,
      `StepRun:refresh-${INDEX}`,
    ]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(runLines(lines)).toHaveLength(1);
  });

  it("rebuilds a save failure's stage and code from the SDK's StepError after the retries", async () => {
    const save = jest.fn();
    const { lines, handler } = harness((core) => {
      save.mockRejectedValue(new core.QuoteStoreError("unavailable"));
      return {
        feeds: [
          { id: INDEX, read: async () => batch([fxRate("uva")]) },
          { id: CRYPTO, read: async () => batch([]) },
        ],
        store: { save },
      };
    });
    const { answer, trace } = await run(handler);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ outcome: "partial", fxRates: 0, prices: 0 });
    expect(trace).toEqual([
      `StepError:refresh-${INDEX}`,
      `StepError:refresh-${INDEX}`,
      `StepFailed:refresh-${INDEX}`,
      `StepRun:refresh-${CRYPTO}`,
    ]);
    expect(save).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(
      feedLines(lines).map((line) => line.fields["plant.inngest.attempt"]),
    ).toEqual([0, 1, 2]);
    expect(runLines(lines)).toHaveLength(1);
    expect(runLines(lines)[0]?.fields).toMatchObject({
      "plant.outcome": "partial",
      "plant.quotes.failed_codes": `${INDEX}:save:unavailable`,
      "plant.quotes.stage": "save",
      "error.type": "unavailable",
    });
  });

  it("reads again on the retry after a save whose answer was lost", async () => {
    const stored = new Set<string>();
    const read = jest
      .fn<Promise<QuoteBatch>, [Date]>()
      .mockResolvedValueOnce(batch([fxRate("mep"), fxRate("ccl")]))
      .mockResolvedValue(batch([fxRate("mep"), fxRate("ccl"), fxRate("blue")]));
    const { lines, handler } = harness((core) => {
      let calls = 0;
      return {
        feeds: [{ id: DOLLARS, read }],
        store: {
          save: async ({ fxRates }) => {
            calls += 1;
            const fresh = fxRates.filter((row) => !stored.has(row.kind));
            for (const row of fresh) stored.add(row.kind);
            // The first answer is lost after its rows committed.
            if (calls === 1) throw new core.QuoteStoreError("unavailable");
            return { fxRates: fresh.length, prices: 0 };
          },
        },
      };
    });
    const { answer } = await run(handler);
    expect(read).toHaveBeenCalledTimes(2);
    expect([...stored].sort()).toEqual(["blue", "ccl", "mep"]);
    // Pin: the run counts only what the attempt that answered inserted.
    expect(answer.body).toEqual({ outcome: "ok", fxRates: 1, prices: 0 });
    expect(runLines(lines)[0]?.fields["plant.quotes.fx_rate_count"]).toBe(1);
  });

  it("answers non-retriable after one run line when every feed failed", async () => {
    const { lines, handler } = harness((core) => ({
      feeds: [
        {
          id: DOLLARS,
          read: async () => {
            throw new core.QuoteFeedError("http_4xx");
          },
        },
        {
          id: INDEX,
          read: async () => {
            throw new core.QuoteFeedError("timeout");
          },
        },
      ],
      store: { save: jest.fn() },
    }));
    const { answer, trace } = await run(handler);
    expect(trace).toEqual([
      `StepRun:refresh-${DOLLARS}`,
      `StepError:refresh-${INDEX}`,
      `StepError:refresh-${INDEX}`,
      `StepFailed:refresh-${INDEX}`,
    ]);
    expect(answer.status).toBe(400);
    expect(answer.noRetry).toBe("true");
    expect(runLines(lines)).toHaveLength(1);
    expect(runLines(lines)[0]).toMatchObject({
      level: "error",
      fields: {
        "plant.outcome": "failed",
        "plant.quotes.failed_codes": [
          `${DOLLARS}:read:http_4xx`,
          `${INDEX}:read:timeout`,
        ]
          .sort()
          .join(","),
      },
    });
  });

  it("syncs with singleton skip, two retries, the cron and the event", () => {
    const { options } = harness(() => ({
      feeds: [],
      store: { save: jest.fn() },
    }));
    const fn = options.functions.find(
      (f) => f.id() === "refresh-quotes",
    ) as unknown as {
      getConfig(opts: { baseUrl: URL; appPrefix: string }): {
        steps: Record<string, { retries?: { attempts: number } }>;
        singleton?: unknown;
        triggers: unknown[];
      }[];
    };
    const [config] = fn.getConfig({
      baseUrl: new URL("http://127.0.0.1:3000/api/inngest"),
      appPrefix: "plant",
    });
    expect(config?.steps.step?.retries).toEqual({ attempts: 2 });
    expect(config?.singleton).toEqual({ mode: "skip" });
    expect(config?.triggers).toEqual([
      { cron: "TZ=America/Argentina/Buenos_Aires 5 18-23 * * *" },
      { event: "plant/quotes.refresh" },
    ]);
  });
});
