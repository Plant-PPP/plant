import { buenosAiresDate, startOfBuenosAiresDay } from "@plant/shared";
import { z } from "zod";

import type { GetJson, RawQuoteFeed } from "../../contract/port";
import { parseResponse, type RawQuoteRows } from "../../contract/quote";

const URL = "https://api.argentinadatos.com/v1/finanzas/indices/uva";

// fecha is a Buenos Aires calendar day, kept as text: new Date("YYYY-MM-DD")
// reads it as UTC midnight, the previous day in Buenos Aires.
const responseSchema = z.array(
  z.object({ fecha: z.iso.date(), valor: z.number() }),
);

// The series runs ahead of today, so the row is the latest entry not after
// today (the last one listed, if a day repeats); a series that lags yields an
// older row, which the window drops.
export function parse(json: unknown, now: Date): RawQuoteRows {
  const series = parseResponse(responseSchema, json);
  const today = buenosAiresDate(now);
  let latest: { fecha: string; valor: number } | undefined;
  for (const entry of series) {
    if (entry.fecha <= today && (!latest || entry.fecha >= latest.fecha)) {
      latest = entry;
    }
  }
  if (!latest) return { fxRates: [], prices: [] };
  return {
    fxRates: [
      {
        kind: "uva",
        rate_date: latest.fecha,
        buy: null,
        sell: String(latest.valor),
        source: "argentinadatos",
        quoted_at: startOfBuenosAiresDay(latest.fecha).toISOString(),
      },
    ],
    prices: [],
  };
}

export function createArgentinadatosFeed(getJson: GetJson): RawQuoteFeed {
  return {
    id: "argentinadatos",
    async readRaw(now) {
      return parse(await getJson(URL), now);
    },
  };
}
