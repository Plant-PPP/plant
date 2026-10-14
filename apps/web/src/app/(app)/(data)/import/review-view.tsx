import { buenosAiresDate } from "@plant/shared";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  confirmImport,
  confirmImportDebts,
  confirmImportOperations,
} from "@/app/(app)/(data)/import/actions";
import { ImportDebtsReview } from "@/components/imports/import-debts-review";
import { ImportOperationsReview } from "@/components/imports/import-operations-review";
import { ImportReview } from "@/components/imports/import-review";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { readLiabilities } from "@/lib/debts/read";
import { cashIn, readHeldCash } from "@/lib/imports/cash";
import { heldElsewhere, heldOn } from "@/lib/imports/confirm";
import { routeRows } from "@/lib/imports/accounts-routing";
import { markLoaded } from "@/lib/imports/operations-loaded";
import { IMPORTS_VIEW_EVENT, readImportForReview } from "@/lib/imports/read";
import { readLedger } from "@/lib/ledger/read";
import { readReferenceDollar } from "@/lib/holdings/read";
import { LoggedError } from "@/lib/log/logged-error";
import { serverLog } from "@/lib/log/server-log";
import { contextFields, type ReadContext } from "@/lib/portfolio-setup/read";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

// One of the user's imports ready to review: its draft beside what the
// account held at the document's date, and where new units may go or come
// from. Any other import, or one that is not the user's, has no page.
export async function ImportReviewView({ id }: { id: string }) {
  if (!z.uuid().safeParse(id).success) notFound();
  const claims = await getSessionClaims();
  const client = await createClient();
  const context: ReadContext = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/import",
    params: {},
  };
  const today = buenosAiresDate(new Date());
  const fail = (error: unknown): never => {
    serverLog.error(
      IMPORTS_VIEW_EVENT,
      { ...contextFields(context), "plant.outcome": "error" },
      error,
    );
    throw new LoggedError("imports.view_failed");
  };
  const [referenceDollar, { ledger }] = await Promise.all([
    readReferenceDollar(client, context),
    readLedger(client, { today, referenceDollar: "mep" }).catch(fail),
  ]);
  const item = await readImportForReview(client, id, ledger.instruments).catch(
    fail,
  );
  if (!item || item.status !== "ready") notFound();
  const account = ledger.accounts.find((each) => each.id === item.accountId);
  const state = { ...ledger, referenceDollar };

  if (item.debts) {
    const debts = await readLiabilities(client).catch(fail);
    serverLog.info(IMPORTS_VIEW_EVENT, {
      ...contextFields(context),
      "plant.outcome": "ok",
      "plant.import.draft": "debts",
      "plant.import.row_count": item.debts.length,
    });
    return (
      <ImportDebtsReview
        item={item}
        institution={account?.institution ?? ""}
        cards={debts.active.filter((debt) => debt.kind === "credit_card")}
        backHref="/import"
        doneHref="/debts"
        actions={{ confirm: confirmImportDebts }}
      />
    );
  }

  const lines = item.operations ?? item.rows;
  serverLog.info(IMPORTS_VIEW_EVENT, {
    ...contextFields(context),
    "plant.outcome": "ok",
    "plant.import.draft": item.operations ? "operations" : "holdings",
    "plant.import.row_count": lines.length,
    "plant.import.unknown_count": lines.filter((row) => row.symbol === "")
      .length,
  });

  if (item.operations) {
    return (
      <ImportOperationsReview
        item={{
          ...item,
          operations: markLoaded(state, item.accountId, item.operations),
        }}
        institution={account?.institution ?? ""}
        instruments={ledger.instruments}
        backHref="/import"
        doneHref="/import"
        actions={{ confirm: confirmImportOperations }}
      />
    );
  }

  const heldDate =
    item.documentDate !== null && item.documentDate <= today
      ? item.documentDate
      : today;
  const heldCash = item.rows.some((row) => row.assetClass === "cash")
    ? await readHeldCash(client).catch(fail)
    : [];
  // A document listing several accounts routes each row to the user's
  // account its label names, and offers every account to choose from.
  const several = item.rows.some((row) => row.accountLabel !== undefined);
  return (
    <ImportReview
      item={
        several
          ? { ...item, rows: routeRows(item.rows, ledger.accounts) }
          : item
      }
      institution={account?.institution ?? ""}
      instruments={ledger.instruments}
      held={heldOn(state, item.accountId, heldDate)}
      cash={cashIn(heldCash, item.accountId)}
      heldCash={heldCash}
      accounts={
        several
          ? ledger.accounts.map((each) => ({
              id: each.id,
              institution: each.institution,
              held: heldOn(state, each.id, heldDate),
              cash: cashIn(heldCash, each.id),
              defaultPortfolioId: each.portfolio.id,
              elsewhere: heldElsewhere(state, each.id),
            }))
          : undefined
      }
      routing={
        account && {
          portfolios: ledger.portfolios,
          defaultPortfolioId: account.portfolio.id,
          elsewhere: heldElsewhere(state, item.accountId),
        }
      }
      backHref="/import"
      doneHref="/import"
      actions={{ confirm: confirmImport }}
    />
  );
}
