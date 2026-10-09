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
// the row is dated that day and quoteWindow decides whether it is kept.
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
    quoted_at: fechaActualizacion,
  };
}

// A house that fails is recorded as unread and the others are kept; the
// factory fails a read where every house did.
type HouseRead =
  | { ok: true; row: RawFxRate }
  | { ok: false; kind: FxRateKind; error: QuoteFeedError };

export function createDolarapiFeed(getJson: GetJson): RawQuoteFeed {
  return {
    id: "dolarapi",
    async readRaw() {
      const results = await Promise.all(
        HOUSES.map(async ({ house, kind }): Promise<HouseRead> => {
          try {
            const json = await getJson(`${BASE_URL}/${house}`);
            return { ok: true, row: parse(json, kind) };
          } catch (error) {
            if (error instanceof QuoteFeedError) {
              return { ok: false, kind, error };
            }
            throw error;
          }
        }),
      );
      const fxRates = results.flatMap((result) =>
        result.ok ? [result.row] : [],
      );
      const failed = results.flatMap((result) => (result.ok ? [] : [result]));
      return {
        fxRates,
        prices: [],
        unread: failed.map(({ kind, error }) => ({
          key: kind,
          code: error.code,
        })),
      };
    },
  };
}
