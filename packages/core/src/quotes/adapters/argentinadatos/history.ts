import {
  buenosAiresDate,
  compareDecimals,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

import type { GetJson } from "../../contract/port";
import { parseResponse } from "../../contract/quote";

// The dollars every movement carries the rate of, by ArgentinaDatos' house
// names: the official rate, the MEP ("bolsa") and the CCL.
export const DOLLAR_HISTORY_HOUSES = {
  official: "oficial",
  mep: "bolsa",
  ccl: "contadoconliqui",
} as const;

export type HistoryKind = keyof typeof DOLLAR_HISTORY_HOUSES;

// A day's rate of one dollar before today, as fx_rates keeps it.
export type HistoricalFxRate = {
  kind: HistoryKind;
  rate_date: string;
  buy: string | null;
  sell: string;
};

const historyUrl = (kind: HistoryKind) =>
  `https://api.argentinadatos.com/v1/cotizaciones/dolares/${DOLLAR_HISTORY_HOUSES[kind]}`;

// A house's whole series is a few thousand days.
const HISTORY_MAX_BYTES = 4 * 1024 * 1024;

const historySchema = z.array(
  z.object({
    fecha: z.iso.date(),
    compra: z.number().nullable().optional(),
    venta: z.number().nullable().optional(),
  }),
);

const decimal = (value: number | null | undefined): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const text = String(value);
  return positiveDecimalSchema.safeParse(text).success ? text : null;
};

// A house's daily series before `today` (YYYY-MM-DD): a day with no selling
// rate is left out, and a buying rate above the selling one (old official
// days) is dropped, since fx_rates refuses it.
export function parseDollarHistory(
  json: unknown,
  kind: HistoryKind,
  today: string,
): HistoricalFxRate[] {
  const series = parseResponse(historySchema, json);
  const rows: HistoricalFxRate[] = [];
  for (const { fecha, compra, venta } of series) {
    const sell = decimal(venta);
    if (fecha >= today || sell === null) continue;
    const buy = decimal(compra);
    rows.push({
      kind,
      rate_date: fecha,
      sell,
      buy: buy !== null && compareDecimals(buy, sell) <= 0 ? buy : null,
    });
  }
  return rows;
}

// The official, MEP and CCL series up to yesterday, in Buenos Aires.
export async function readDollarHistory(
  getJson: GetJson,
  now: Date,
): Promise<HistoricalFxRate[]> {
  const today = buenosAiresDate(now);
  const kinds = Object.keys(DOLLAR_HISTORY_HOUSES) as HistoryKind[];
  const series = await Promise.all(
    kinds.map(async (kind) =>
      parseDollarHistory(
        await getJson(historyUrl(kind), { maxBytes: HISTORY_MAX_BYTES }),
        kind,
        today,
      ),
    ),
  );
  return series.flat();
}
