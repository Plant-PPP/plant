import { buenosAiresDate } from "@plant/shared";
import { z } from "zod";

import type { GetJson, RawQuoteFeed } from "../../contract/port";
import {
  type FxRateKind,
  parseResponse,
  QuoteFeedError,
  type RawFxRate,
} from "../../contract/quote";

const BASE_URL = "https://dolarapi.com/v1/dolares";

// One endpoint per house: the list at /v1/dolares has lagged a day behind
// them on business days.
const HOUSES: readonly { house: string; kind: FxRateKind }[] = [
  { house: "oficial", kind: "official" },
  { house: "bolsa", kind: "mep" },
  { house: "contadoconliqui", kind: "ccl" },
  { house: "blue", kind: "blue" },
];

const responseSchema = z.object({
  compra: z.number(),
  venta: z.number(),
  fechaActualizacion: z.iso.datetime({ offset: true }),
});

// On weekends and holidays the house still stamps its last business day, so
// the row is dated that day and the window drops it.
export function parse(json: unknown, kind: FxRateKind): RawFxRate {
  const { compra, venta, fechaActualizacion } = parseResponse(
    responseSchema,
    json,
  );
  return {
    kind,
    rate_date: buenosAiresDate(new Date(fechaActualizacion)),
    buy: String(compra),
    sell: String(venta),
    source: "dolarapi",
    quoted_at: fechaActualizacion,
  };
}

// A house that changed shape or went away becomes one row the schemas count as
// invalid, so the other houses are kept.
function unreadable(kind: FxRateKind, now: Date): RawFxRate {
  return {
    kind,
    rate_date: buenosAiresDate(now),
    buy: null,
    sell: "",
    source: "dolarapi",
    quoted_at: now.toISOString(),
  };
}

export function createDolarapiFeed(getJson: GetJson): RawQuoteFeed {
  return {
    id: "dolarapi",
    async readRaw(now) {
      const fxRates = await Promise.all(
        HOUSES.map(async ({ house, kind }) => {
          try {
            return parse(await getJson(`${BASE_URL}/${house}`), kind);
          } catch (error) {
            if (error instanceof QuoteFeedError && !error.retryable) {
              return unreadable(kind, now);
            }
            throw error;
          }
        }),
      );
      return { fxRates, prices: [] };
    },
  };
}
