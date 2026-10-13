import { buenosAiresDate } from "@plant/shared";
import { notFound } from "next/navigation";
import { z } from "zod";

import { confirmImport } from "@/app/(app)/(data)/import/actions";
import { ImportReview } from "@/components/imports/import-review";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { heldElsewhere, heldOn } from "@/lib/imports/confirm";
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

  serverLog.info(IMPORTS_VIEW_EVENT, {
    ...contextFields(context),
    "plant.outcome": "ok",
    "plant.import.row_count": item.rows.length,
    "plant.import.unknown_count": item.rows.filter((row) => row.symbol === "")
      .length,
  });

  return (
    <ImportReview
      item={item}
      institution={account?.institution ?? ""}
      instruments={ledger.instruments}
      held={heldOn(
        state,
        item.accountId,
        item.documentDate !== null && item.documentDate <= today
          ? item.documentDate
          : today,
      )}
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
