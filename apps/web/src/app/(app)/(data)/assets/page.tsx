import { quotesNeeded, readSnapshot, referenceUnit } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { Metadata } from "next";

import {
  archiveHolding,
  createHolding,
  restoreHolding,
  updateHolding,
} from "@/app/(app)/(data)/assets/actions";
import {
  createOperation,
  deleteManualPrice,
  deleteOperation,
  loadMovements,
  setManualPrice,
  updateOperation,
} from "@/app/(app)/(data)/assets/movement-actions";
import {
  AssetsSetup,
  type ScopeHrefs,
} from "@/components/holdings/assets-setup";
import { PrototypeAssets } from "@/components/prototype/prototype-assets";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { isProductionDeployment } from "@/lib/deployment";
import { SALES_TABS } from "@/lib/holdings/assets-filter";
import { assetsSelection } from "@/lib/holdings/assets-selection";
import {
  ASSETS_VIEW_EVENT,
  assetsViewFailure,
} from "@/lib/holdings/assets-view";
import { instrumentNames } from "@/lib/holdings/holding-name";
import {
  readHoldings,
  readInstruments,
  readReferenceDollar,
} from "@/lib/holdings/read";
import {
  type HoldingsValuation,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";
import {
  positionsOf,
  pricedSnapshotOf,
  salesOf,
  yearsOf,
} from "@/lib/ledger/ledger";
import { readLedger } from "@/lib/ledger/read";
import { serverLog } from "@/lib/log/server-log";
import { SALES_LIMIT } from "@/lib/portfolio-setup/limits";
import { navTitle } from "@/lib/navigation";
import {
  contextFields,
  readPortfolios,
  readSourceConnections,
} from "@/lib/portfolio-setup/read";
import { createQuoteReader } from "@/lib/quotes/quote-reader";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: navTitle("/assets") };

// The pages a scope's name links to. The account and portfolio pages arrive
// with PLA-106, so their links stay on Activos until then.
const HREFS: ScopeHrefs = {
  instrument: (symbol) => `/assets/${encodeURIComponent(symbol)}`,
  account: () => "/accounts",
  portfolio: () => "/accounts",
};
export const dynamic = "force-dynamic";

// The user's holdings valued at today's quotes in one unit (the reference
// dollar unless ?unit= names another), in one portfolio (?portfolio=) or all,
// of one class (?class=) or all, matching a search (?search=) or not; shown in
// the holdings tab unless ?tab= names another. An invalid param falls back
// to the default and is logged. Outside production it shows made-up data.
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isProductionDeployment()) {
    return (
      <div>
        <h1 className="sr-only">{navTitle("/assets")}</h1>
        <PrototypeAssets params={await searchParams} />
      </div>
    );
  }
  const claims = await getSessionClaims();
  const client = await createClient();
  const context = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/assets" as const,
    params: await searchParams,
  };
  const today = buenosAiresDate(new Date());
  const [
    { holdings, quotes },
    accounts,
    portfolios,
    instruments,
    dollar,
    { ledger: read, truncated: ledgerTruncated },
  ] = await Promise.all([
    readHoldings(client, context).then(async (holdings) => ({
      holdings,
      quotes: await readSnapshot(
        createQuoteReader(client),
        today,
        quotesNeeded(holdings.active.map((row) => row.holding)),
      ).catch((error: unknown) =>
        assetsViewFailure(context, "snapshot", error),
      ),
    })),
    readSourceConnections(client, context, { archived: false }),
    readPortfolios(client, context, { archived: false }),
    readInstruments(client, context),
    readReferenceDollar(client, context),
    // Its reference dollar is the profile's, set below.
    readLedger(client, { today, referenceDollar: "mep" }).catch(
      (error: unknown) => assetsViewFailure(context, "ledger", error),
    ),
  ]);
  const ledger = { ...read, referenceDollar: dollar };
  // Today's quotes with the user's manual prices and dollar rates.
  const priced = pricedSnapshotOf(ledger, quotes.snapshot);
  const years = yearsOf(ledger);

  const names = instrumentNames(instruments.rows);
  const {
    unit: chosenUnit,
    tab,
    year,
    filter,
    invalid,
    shown,
  } = assetsSelection({
    params: context.params,
    rows: holdings.active,
    portfolioIds: portfolios.active.map(({ id }) => id),
    tabs: SALES_TABS,
    salesYears: years,
    names,
  });
  const reference = referenceUnit(dollar);
  const unit = chosenUnit ?? reference;
  const filtered =
    filter.portfolioId !== null ||
    filter.holdingClass !== null ||
    filter.search !== "";

  let valuation: HoldingsValuation;
  try {
    valuation = holdingsValuation({
      holdings: shown,
      truncated: holdings.activeTruncated,
      snapshot: priced.snapshot,
      unit,
      referenceDollar: dollar,
    });
  } catch (error) {
    assetsViewFailure(context, "valuation", error);
  }

  serverLog.info(ASSETS_VIEW_EVENT, {
    ...contextFields(context),
    "plant.outcome": valuation.kinds.total.complete ? "ok" : "incomplete",
    "plant.assets.holding_count": holdings.active.length,
    "plant.assets.shown_count": shown.length,
    "plant.assets.missing_count": valuation.kinds.total.missing,
    "plant.assets.truncated": holdings.activeTruncated,
    "plant.assets.instruments_truncated": instruments.truncated,
    "plant.assets.unit": unit,
    // The valuation's counts cover only the shown holdings when filtered.
    "plant.assets.filtered": filtered,
    "plant.assets.class": filter.holdingClass ?? "all",
    "plant.assets.searched": filter.search !== "",
    "plant.assets.tab": tab,
    "plant.assets.invalid_unit": invalid.unit,
    "plant.assets.invalid_portfolio": invalid.portfolio,
    "plant.assets.invalid_class": invalid.class,
    "plant.assets.invalid_search": invalid.search,
    "plant.assets.invalid_tab": invalid.tab,
    "plant.quotes.dropped_count": quotes.invalidCount,
    "plant.ledger.truncated": ledgerTruncated,
    "plant.ledger.movement_count": [...ledger.movements.values()].reduce(
      (sum, own) => sum + own.length,
      0,
    ),
  });

  return (
    <div>
      <h1 className="sr-only">{navTitle("/assets")}</h1>
      <AssetsSetup
        holdings={holdings}
        valuation={valuation}
        unit={unit}
        referenceUnit={reference}
        filter={filter}
        params={context.params}
        accounts={accounts.active}
        portfolios={portfolios.active}
        instruments={instruments.rows}
        today={today}
        tabs={SALES_TABS}
        actions={{
          create: createHolding,
          update: updateHolding,
          archiving: { archive: archiveHolding, restore: restoreHolding },
        }}
        movements={{
          positions: positionsOf(ledger, unit),
          revisions: ledger.revisions,
          sales: salesOf(ledger, {
            year,
            unit,
            filter,
            names,
            limit: SALES_LIMIT,
          }),
          years,
          loadMovements,
        }}
        movementActions={{
          create: createOperation,
          update: updateOperation,
          delete: deleteOperation,
        }}
        prices={{
          manual: new Map(
            [...priced.manual].map(([symbol, date]) => [
              symbol,
              { price: priced.snapshot.prices[symbol]!.price, date },
            ]),
          ),
          fed: (symbol) => quotes.snapshot.prices[symbol] !== undefined,
          actions: { set: setManualPrice, delete: deleteManualPrice },
        }}
        hrefs={HREFS}
      />
    </div>
  );
}
