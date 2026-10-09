import { buenosAiresDate } from "@plant/shared";
import { z } from "zod";

import type { GetJson, RawQuoteFeed } from "../../contract/port";
import {
  type FxRateKind,
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
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new QuoteFeedError("bad_shape", false);
  const { compra, venta, fechaActualizacion } = parsed.data;
  return {
    kind,
    rate_date: buenosAiresDate(new Date(fechaActualizacion)),
    buy: String(compra),
    sell: String(venta),
    source: "dolarapi",
    quoted_at: fechaActualizacion,
  };
}

export function createDolarapiFeed(getJson: GetJson): RawQuoteFeed {
  return {
    id: "dolarapi",
    async readRaw() {
      const fxRates = await Promise.all(
        HOUSES.map(async ({ house, kind }) =>
          parse(await getJson(`${BASE_URL}/${house}`), kind),
        ),
      );
      return { fxRates, prices: [] };
    },
  };
}
