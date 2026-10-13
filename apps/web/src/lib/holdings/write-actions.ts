import type { WriteResult } from "@/lib/portfolio-setup/write-result";

import type { HoldingDeleteResult } from "./delete-result";
import type { MovementResult } from "./movements-input";
import type { PriceResult } from "./price-input";

// What the screen's writes call. A page whose holdings can be archived passes
// archiving; the page without it lists no archived holdings.
export type HoldingActions = {
  create: (input: unknown) => Promise<WriteResult>;
  update: (id: string, input: unknown) => Promise<WriteResult>;
  archiving?: {
    archive: (id: string) => Promise<WriteResult>;
    restore: (id: string) => Promise<WriteResult>;
  };
  // A page that deletes holdings, each with its movements.
  delete?: (id: string) => Promise<HoldingDeleteResult>;
};

export type PriceActions = {
  set: (input: unknown) => Promise<PriceResult>;
  delete?: (symbol: string, date: string) => Promise<PriceResult>;
};

export type MovementActions = {
  create: (input: unknown) => Promise<MovementResult>;
  update: (id: string, input: unknown) => Promise<MovementResult>;
  // Deletes a whole operation, every portfolio's part of it.
  delete?: (operationId: string) => Promise<MovementResult>;
};
