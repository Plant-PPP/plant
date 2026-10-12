import type { WriteResult } from "@/lib/portfolio-setup/write-result";

// A holding delete, refused while the holding has a transfer with another
// portfolio.
export type HoldingDeleteResult =
  WriteResult | { ok: false; code: "holding_has_transfers" };
