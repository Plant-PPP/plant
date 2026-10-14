import type { Metadata } from "next";

import {
  acceptTerms,
  finishUpload,
  startUpload,
} from "@/app/(app)/(data)/import/actions";
import { UploadImports } from "@/components/imports/upload-imports";
import { PrototypeImports } from "@/components/prototype/prototype-imports";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { isProductionDeployment } from "@/lib/deployment";
import { IMPORTS_VIEW_EVENT, readImports } from "@/lib/imports/read";
import { termsAccepted } from "@/lib/imports/write";
import { LoggedError } from "@/lib/log/logged-error";
import { serverLog } from "@/lib/log/server-log";
import { navTitle } from "@/lib/navigation";
import {
  contextFields,
  type ReadContext,
  readSourceConnections,
} from "@/lib/portfolio-setup/read";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: navTitle("/import") };
export const dynamic = "force-dynamic";

// Upload statements into an account and follow their imports. Outside
// production it reads made-up statements.
export default async function ImportPage() {
  if (!isProductionDeployment()) return <PrototypeImports />;
  const claims = await getSessionClaims();
  const client = await createClient();
  const context: ReadContext = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/import",
    params: {},
  };
  const [accounts, reads] = await Promise.all([
    readSourceConnections(client, context),
    Promise.all([readImports(client), termsAccepted(client)]).catch(
      (error: unknown) => {
        serverLog.error(
          IMPORTS_VIEW_EVENT,
          { ...contextFields(context), "plant.outcome": "error" },
          error,
        );
        throw new LoggedError("imports.view_failed");
      },
    ),
  ]);
  const [{ items, used }, accepted] = reads;

  serverLog.info(IMPORTS_VIEW_EVENT, {
    ...contextFields(context),
    "plant.outcome": "ok",
    "plant.import.count": items.length,
    "plant.import.month_count": used,
    "plant.import.terms_accepted": accepted,
  });

  return (
    <UploadImports
      userId={claims.sub}
      accounts={accounts.active}
      archivedAccounts={accounts.archived}
      imports={items}
      used={used}
      termsAccepted={accepted}
      actions={{ start: startUpload, finish: finishUpload, acceptTerms }}
    />
  );
}
