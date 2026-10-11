import { quotesNeeded, readSnapshot, referenceUnit } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { Metadata } from "next";

import {
  archiveHolding,
  createHolding,
  restoreHolding,
  updateHolding,
} from "@/app/(app)/assets/actions";
import { AssetsSetup } from "@/components/holdings/assets-setup";
import { PrototypeAssets } from "@/components/prototype/prototype-assets";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { isProductionDeployment } from "@/lib/deployment";
import { TABS } from "@/lib/holdings/assets-filter";
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
import { serverLog } from "@/lib/log/server-log";
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
  const [{ holdings, quotes }, accounts, portfolios, instruments, dollar] =
    await Promise.all([
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
    ]);

  const names = instrumentNames(instruments.rows);
  const {
    unit: chosenUnit,
    tab,
    filter,
    invalid,
    shown,
  } = assetsSelection({
    params: context.params,
    rows: holdings.active,
    portfolioIds: portfolios.active.map(({ id }) => id),
    tabs: TABS,
    salesYears: [],
    names,
  });
  const reference = referenceUnit(dollar);
  const unit = chosenUnit ?? reference;
  const filtered =
    filter.portfolioId !== null ||
    filter.assetClass !== null ||
    filter.search !== "";

  let valuation: HoldingsValuation;
  try {
    valuation = holdingsValuation({
      holdings: shown,
      truncated: holdings.activeTruncated,
      snapshot: quotes.snapshot,
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
    "plant.assets.asset_class": filter.assetClass ?? "all",
    "plant.assets.searched": filter.search !== "",
    "plant.assets.tab": tab,
    "plant.assets.invalid_unit": invalid.unit,
    "plant.assets.invalid_portfolio": invalid.portfolio,
    "plant.assets.invalid_class": invalid.class,
    "plant.assets.invalid_search": invalid.search,
    "plant.assets.invalid_tab": invalid.tab,
    "plant.quotes.dropped_count": quotes.invalidCount,
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
        tabs={TABS}
        actions={{
          create: createHolding,
          update: updateHolding,
          archiving: { archive: archiveHolding, restore: restoreHolding },
        }}
      />
    </div>
  );
}
