import {
  priceSource,
  quotesNeeded,
  readSnapshot,
  referenceUnit,
} from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { deleteHolding } from "@/app/(app)/(data)/assets/actions";
import {
  createOperation,
  deleteOperation,
  loadMovements,
  quoteOn,
  transferCost,
  updateOperation,
} from "@/app/(app)/(data)/assets/movement-actions";
import { InstrumentHistory } from "@/components/holdings/instrument-history";
import { PrototypeInstrument } from "@/components/prototype/prototype-instrument";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { isProductionDeployment } from "@/lib/deployment";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { instrumentSummary } from "@/lib/holdings/instrument-history";
import { readReferenceDollar } from "@/lib/holdings/read";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import {
  instrumentHoldings,
  positionsOf,
  pricedSnapshotOf,
} from "@/lib/ledger/ledger";
import { readLedger } from "@/lib/ledger/read";
import { navTitle } from "@/lib/navigation";
import { createQuoteReader } from "@/lib/quotes/quote-reader";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: navTitle("/assets") };
export const dynamic = "force-dynamic";

// One instrument's history across every account and portfolio, in one unit
// (the reference dollar unless ?unit= names another). A symbol the user holds
// nothing of, open or closed, has no page. Outside production it shows
// made-up data.
export default async function InstrumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const symbol = (await params).symbol.toUpperCase();
  const query = await searchParams;
  if (!isProductionDeployment()) {
    return <PrototypeInstrument symbol={symbol} params={query} />;
  }
  const claims = await getSessionClaims();
  const client = await createClient();
  const context = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/assets" as const,
    params: query,
  };
  const today = buenosAiresDate(new Date());
  const [dollar, { ledger: read }] = await Promise.all([
    readReferenceDollar(client, context),
    readLedger(client, { today, referenceDollar: "mep" }).catch(
      (error: unknown) => assetsViewFailure(context, "ledger", error),
    ),
  ]);
  const ledger = { ...read, referenceDollar: dollar };
  const instrument = ledger.instruments.find((each) => each.symbol === symbol);
  if (!instrument) notFound();
  const held = ledger.holdings.filter(
    ({ holding }) =>
      holding.asset_class === "instrument" &&
      holding.instrument_symbol === symbol,
  );
  if (held.length === 0) notFound();
  const quotes = await readSnapshot(
    createQuoteReader(client),
    today,
    quotesNeeded(held.map(({ holding }) => holding)),
  ).catch((error: unknown) => assetsViewFailure(context, "snapshot", error));
  const priced = pricedSnapshotOf(ledger, quotes.snapshot);
  const reference = referenceUnit(dollar);
  const { unit: chosen } = parseAssetsParams(query, {
    portfolioIds: [],
    tabs: TABS,
    salesYears: [],
  });
  const unit = chosen ?? reference;
  const { holdings, flows, value } = instrumentHoldings(
    ledger,
    symbol,
    unit,
    priced.snapshot,
  );
  const first = holdings[0];
  // One unit's price in the page's unit, as Activos shows it.
  const one =
    first &&
    holdingsValuation({
      holdings: [
        { ...first.row, holding: { ...first.row.holding, amount: "1" } },
      ],
      truncated: false,
      snapshot: priced.snapshot,
      unit,
      referenceDollar: dollar,
    });
  return (
    <InstrumentHistory
      instrument={instrument}
      price={{
        value: (first && one?.values[first.row.id]?.price) ?? null,
        source: priceSource(symbol, priced),
        date: priced.snapshot.prices[symbol]?.date ?? null,
      }}
      unit={unit}
      referenceUnit={reference}
      params={query}
      backHref="/assets"
      holdings={holdings}
      summary={instrumentSummary(holdings, flows, today, value)}
      movements={{
        positions: positionsOf(ledger, unit),
        revisions: ledger.revisions,
        loadMovements,
        transferCost,
        quoteOn,
      }}
      movementActions={{
        create: createOperation,
        update: updateOperation,
        delete: deleteOperation,
      }}
      actions={{ delete: deleteHolding }}
      accounts={ledger.accounts}
      portfolios={ledger.portfolios}
      instruments={ledger.instruments}
      today={today}
    />
  );
}
