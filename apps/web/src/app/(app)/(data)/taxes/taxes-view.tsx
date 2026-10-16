import { buenosAiresDate } from "@plant/shared";

import { TaxesPage } from "@/components/taxes/taxes-page";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { readReferenceDollar } from "@/lib/holdings/read";
import { serverLog } from "@/lib/log/server-log";
import { contextFields, type ReadContext } from "@/lib/portfolio-setup/read";
import { currentRequestId } from "@/lib/request-id-server";
import { closesReadFields, readCloses } from "@/lib/summary/read";
import type { KeysetParams } from "@/lib/supabase/keyset";
import { createClient } from "@/lib/supabase/server";
import {
  readExclusions,
  readOfficialBuy,
  TAXES_VIEW_EVENT,
} from "@/lib/taxes/read";
import {
  defaultTaxYear,
  leftOutOf,
  type TaxReport,
  taxDate,
  taxReport,
  taxYearOf,
  taxYears,
} from "@/lib/taxes/report";

// Impuestos over the user's data: the ledger and holdings the closes read,
// the assets left out of the report and the official buying rate of the
// year's last day.
export async function TaxesView({ params }: { params: KeysetParams }) {
  const claims = await getSessionClaims();
  const client = await createClient();
  const context: ReadContext = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/taxes",
    params,
  };
  const today = buenosAiresDate(new Date());
  const referenceDollar = await readReferenceDollar(client, context);
  const read = await readCloses(client, context, { today, referenceDollar });
  const { state } = read;
  const years = taxYears(state);
  const year = taxYearOf(params.year, years, today);
  const [officialBuy, euroBuy, excluded] = await Promise.all([
    readOfficialBuy(client, taxDate(year, today), "official"),
    readOfficialBuy(client, taxDate(year, today), "eur"),
    readExclusions(client),
  ]).catch((error: unknown) => assetsViewFailure(context, "taxes", error));

  let report: TaxReport;
  try {
    report = taxReport(state, {
      year,
      officialBuy,
      euroBuy,
      leftOut: leftOutOf(state, excluded),
      // The real pages keep no placement kind: every placement at a rate is
      // a plazo fijo.
      isPlazoFijo: () => true,
    });
  } catch (error) {
    assetsViewFailure(context, "valuation", error);
  }

  serverLog.info(TAXES_VIEW_EVENT, {
    ...contextFields(context),
    "plant.outcome":
      report.wealth.complete && report.gains.complete ? "ok" : "incomplete",
    "plant.taxes.provisional": report.provisional,
    "plant.taxes.official_buy": officialBuy !== null,
    "plant.taxes.euro_buy": euroBuy !== null,
    "plant.taxes.asset_count": report.wealth.lines.length,
    "plant.taxes.left_out_count": report.leftOut,
    "plant.taxes.gains_group_count": report.gains.groups.length,
    ...closesReadFields(read),
  });

  return (
    <TaxesPage
      report={report}
      years={years}
      defaultYear={defaultTaxYear(years, today)}
      placementKinds={false}
      assetExclusion={false}
    />
  );
}
