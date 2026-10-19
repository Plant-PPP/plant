import { quotesNeeded, readSnapshot, referenceUnit } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  connectApiKey,
  disconnectApiKey,
  syncAccount,
} from "@/app/(app)/(data)/accounts/api-key-actions";
import {
  importAccountStatement,
  writeAccountCash,
} from "@/app/(app)/(data)/accounts/cash-actions";
import { loadMovements } from "@/app/(app)/(data)/assets/movement-actions";
import { discardImport } from "@/app/(app)/(data)/import/actions";
import { CashHistory } from "@/components/holdings/cash-history";
import { ApiKeyCard } from "@/components/connections/api-key-card";
import { type Scope, ScopePage } from "@/components/holdings/scope-page";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { accountCash } from "@/lib/cash/view";
import { connectionForm, providerOf } from "@/lib/connections/api-key";
import { readApiKey } from "@/lib/connections/write";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { instrumentNames } from "@/lib/holdings/holding-name";
import {
  type HoldingRow,
  readHoldings,
  readReferenceDollar,
} from "@/lib/holdings/read";
import { SCOPE_HREFS } from "@/lib/holdings/scope-hrefs";
import {
  type HoldingsValuation,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";
import {
  allRows,
  closedIds,
  positionsOf,
  pricedSnapshotOf,
} from "@/lib/ledger/ledger";
import { readLedger } from "@/lib/ledger/read";
import { serverLog } from "@/lib/log/server-log";
import { contextFields } from "@/lib/portfolio-setup/read";
import { createQuoteReader } from "@/lib/quotes/quote-reader";
import type { KeysetParams } from "@/lib/supabase/keyset";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

export const SCOPE_VIEW_EVENT = "scope.view";

// One of the user's open accounts or portfolios: its holdings valued at
// today's quotes in one unit (the reference dollar unless ?unit= names
// another), the ones it sold out, and its movements. An archived one, or one
// the user does not have, has no page.
export async function ScopeView({
  kind,
  id,
  params,
}: {
  kind: Scope["kind"];
  id: string;
  params: KeysetParams;
}) {
  if (!z.uuid().safeParse(id).success) notFound();
  const claims = await getSessionClaims();
  const client = await createClient();
  const context = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/accounts" as const,
    params,
  };
  const today = buenosAiresDate(new Date());
  const [holdings, dollar, { ledger: read, truncated }] = await Promise.all([
    readHoldings(client, context),
    readReferenceDollar(client, context),
    // Its reference dollar is the profile's, set below.
    readLedger(client, { today, referenceDollar: "mep" }).catch(
      (error: unknown) => assetsViewFailure(context, "ledger", error),
    ),
  ]);
  const ledger = { ...read, referenceDollar: dollar };
  const account = ledger.accounts.find((each) => each.id === id);
  const portfolio = ledger.portfolios.find((each) => each.id === id);
  const scope: Scope | null =
    kind === "account"
      ? account
        ? { kind, id, institution: account.institution }
        : null
      : portfolio
        ? { kind, id, name: portfolio.name }
        : null;
  if (!scope) notFound();

  // An exchange account offers its key; any account that holds one shows it.
  const apiKey =
    scope.kind === "account"
      ? await readApiKey(client, id).catch((error: unknown) =>
          assetsViewFailure(context, "api_key", error),
        )
      : null;
  const cash =
    scope.kind === "account"
      ? await accountCash(client, id, ledger).catch((error: unknown) =>
          assetsViewFailure(context, "cash_movements", error),
        )
      : null;
  const provider =
    apiKey?.provider ??
    (scope.kind === "account" ? providerOf(scope.institution) : null);

  const inScope = (row: HoldingRow) =>
    kind === "account" ? row.account.id === id : row.portfolio.id === id;
  const rows = holdings.active.filter(inScope);
  const closed = closedIds(ledger);
  const soldRows = allRows(ledger).filter(
    (row) => inScope(row) && closed.has(row.id),
  );
  const quotes = await readSnapshot(
    createQuoteReader(client),
    today,
    quotesNeeded(rows.map((row) => row.holding)),
  ).catch((error: unknown) => assetsViewFailure(context, "snapshot", error));
  const priced = pricedSnapshotOf(ledger, quotes.snapshot);
  const reference = referenceUnit(dollar);
  const { unit: chosen } = parseAssetsParams(params, {
    portfolioIds: [],
    tabs: TABS,
    salesYears: [],
  });
  const unit = chosen ?? reference;
  let valuation: HoldingsValuation;
  try {
    valuation = holdingsValuation({
      holdings: rows,
      truncated: holdings.activeTruncated,
      snapshot: priced.snapshot,
      unit,
      referenceDollar: dollar,
    });
  } catch (error) {
    assetsViewFailure(context, "valuation", error);
  }

  serverLog.info(SCOPE_VIEW_EVENT, {
    ...contextFields(context),
    "plant.outcome": valuation.kinds.total.complete ? "ok" : "incomplete",
    "plant.scope.kind": kind,
    "plant.assets.holding_count": rows.length,
    "plant.assets.sold_count": soldRows.length,
    "plant.assets.missing_count": valuation.kinds.total.missing,
    "plant.assets.truncated": holdings.activeTruncated,
    "plant.assets.unit": unit,
    "plant.quotes.dropped_count": quotes.invalidCount,
    "plant.ledger.truncated": truncated,
  });

  return (
    <ScopePage
      scope={scope}
      rows={rows}
      soldRows={soldRows}
      valuation={valuation}
      positions={positionsOf(ledger, unit)}
      names={instrumentNames(ledger.instruments)}
      unit={unit}
      referenceUnit={reference}
      params={params}
      hrefs={SCOPE_HREFS}
      backHref="/accounts"
      revision={[...rows, ...soldRows]
        .map((row) => ledger.revisions.get(row.id) ?? 0)
        .join(".")}
      loadMovements={loadMovements}
      cash={
        cash && (
          <CashHistory
            accountId={id}
            sides={cash}
            today={today}
            actions={{
              write: writeAccountCash,
              importStatement: importAccountStatement,
            }}
          />
        )
      }
      connection={
        provider && (
          <ApiKeyCard
            key="connection"
            accountId={id}
            form={connectionForm(provider)}
            apiKey={apiKey}
            actions={{
              connect: connectApiKey,
              disconnect: disconnectApiKey,
              sync: syncAccount,
              cancel: discardImport,
            }}
          />
        )
      }
    />
  );
}
