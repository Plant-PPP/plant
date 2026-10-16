import "server-only";
import { QuoteStoreError } from "@plant/core";

import { LedgerReadError } from "@/lib/ledger/read";
import { LoggedError } from "@/lib/log/logged-error";
import { serverLog } from "@/lib/log/server-log";
import { contextFields, type ReadContext } from "@/lib/portfolio-setup/read";

export const ASSETS_VIEW_EVENT = "assets.view";

// What the assets page was reading when it failed.
export type AssetsRead =
  | "instruments"
  | "profile"
  | "snapshot"
  | "valuation"
  | "ledger"
  | "debts"
  | "debt_events"
  | "debt_collateral"
  | "archived_cash"
  | "api_key"
  | "taxes";

// Logs one failure of the assets page and throws it as already logged, so the
// (app) error page shows a retry.
export function assetsViewFailure(
  context: ReadContext,
  read: AssetsRead,
  error: unknown,
): never {
  serverLog.error(
    ASSETS_VIEW_EVENT,
    {
      ...contextFields(context),
      "plant.assets.read": read,
      "plant.outcome": "error",
      "plant.quotes.store_code":
        error instanceof QuoteStoreError ? error.storeCode : undefined,
      "plant.ledger.step":
        error instanceof LedgerReadError ? error.step : undefined,
    },
    error,
  );
  throw new LoggedError("assets.view_failed");
}
