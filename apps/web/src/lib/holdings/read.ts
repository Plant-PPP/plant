import "server-only";
import {
  type Holding,
  holdingSchema,
  INSTRUMENT_TYPES,
  type InstrumentType,
  type ReferenceDollar,
} from "@plant/core";
import type { Currency, Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { PortfolioSetupError } from "@/lib/portfolio-setup/errors";
import {
  type ListView,
  type ReadContext,
  readList,
} from "@/lib/portfolio-setup/read";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

import { assetsViewFailure } from "./assets-view";

type Client = SupabaseClient<Database>;

export type HoldingRow = {
  id: string;
  holding: Holding;
  account: { id: string; institution: string };
  portfolio: { id: string; name: string };
  // The instrument's type, on an instrument holding only.
  instrumentType: InstrumentType | null;
};
export type HoldingsView = ListView<HoldingRow>;

export type InstrumentRow = {
  symbol: string;
  name: string;
  currency: Currency;
  type: InstrumentType;
};

const embeds = z.object({
  source_connection: z.object({
    id: z.string(),
    institution: z.string(),
  }),
  portfolio: z.object({ id: z.string(), name: z.string() }),
  instrument: z.object({ type: z.enum(INSTRUMENT_TYPES) }).nullable(),
});

// Amounts are selected as text, so they stay exact decimal strings. The
// account and the portfolio are embedded through the composite
// foreign keys, so each is the holding owner's; RLS applies to them as well.
const HOLDING_COLUMNS =
  "id, portfolio_id, asset_class, instrument_symbol, amount:amount::text, currency, " +
  "annual_rate:annual_rate::text, started_on, matures_on, valued_on, label, " +
  "source_connection:source_connections!holdings_user_id_source_connection_id_fkey" +
  "(id, institution), " +
  "portfolio:portfolios!holdings_user_id_portfolio_id_fkey(id, name), " +
  "instrument:instruments!holdings_instrument_symbol_fkey(type)";

export function readHoldings(
  client: Client,
  context: ReadContext,
): Promise<HoldingsView> {
  return readList(
    client,
    {
      table: "holdings",
      param: "holdings",
      columns: HOLDING_COLUMNS,
      toRow: (data) => {
        const {
          source_connection: account,
          portfolio,
          instrument,
        } = embeds.parse(data);
        const holding = holdingSchema.parse(data);
        // The instrument's type comes through its foreign key, so only an
        // instrument holding has one, and it always does.
        z.literal(holding.asset_class === "instrument").parse(
          instrument !== null,
        );
        return {
          id: String(data.id),
          holding,
          account,
          portfolio,
          instrumentType: instrument?.type ?? null,
        };
      },
    },
    context,
  );
}

// More than a dialog's list can hold; past it the list is cut and logged.
export const INSTRUMENT_LIMIT = 200;

export async function readInstruments(
  client: Client,
  context: ReadContext,
): Promise<{ rows: InstrumentRow[]; truncated: boolean }> {
  const result = await client
    .from("instruments")
    .select("symbol, name, currency, type")
    .order("symbol")
    .limit(INSTRUMENT_LIMIT + 1);
  const failure = classifyPostgrestResult(result, 200);
  if (failure) {
    assetsViewFailure(
      context,
      "instruments",
      new PortfolioSetupError(failure.code),
    );
  }
  const rows = result.data ?? [];
  return {
    rows: rows.slice(0, INSTRUMENT_LIMIT),
    truncated: rows.length > INSTRUMENT_LIMIT,
  };
}

export async function readReferenceDollar(
  client: Client,
  context: ReadContext,
): Promise<ReferenceDollar> {
  const result = await client
    .from("profiles")
    .select("reference_dollar")
    .eq("user_id", context.userId)
    .single();
  const failure = classifyPostgrestResult(result, 200);
  if (failure || !result.data) {
    assetsViewFailure(
      context,
      "profile",
      new PortfolioSetupError(failure?.code ?? "no_profile"),
    );
  }
  return result.data.reference_dollar;
}
