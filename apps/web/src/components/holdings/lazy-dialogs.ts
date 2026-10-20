"use client";

import dynamic from "next/dynamic";

// The holdings pages' dialogs, each in a chunk of its own: a page shows
// without them and loads them once idle (preloadHoldingDialogs).
export const HoldingDialog = dynamic(
  () => import("./holding-dialog").then((module) => module.HoldingDialog),
  { ssr: false },
);
export const MovementDialog = dynamic(
  () => import("./movement-dialog").then((module) => module.MovementDialog),
  { ssr: false },
);
export const PriceDialog = dynamic(
  () => import("./price-dialog").then((module) => module.PriceDialog),
  { ssr: false },
);
export const RealEstateDialog = dynamic(
  () =>
    import("./real-estate-dialog").then((module) => module.RealEstateDialog),
  { ssr: false },
);
export const RenewDialog = dynamic(
  () => import("./renew-dialog").then((module) => module.RenewDialog),
  { ssr: false },
);
export const CashEntryDialog = dynamic(
  () => import("./cash-entry-dialog").then((module) => module.CashEntryDialog),
  { ssr: false },
);
export const StatementDialog = dynamic(
  () => import("./statement-dialog").then((module) => module.StatementDialog),
  { ssr: false },
);

export const preloadHoldingDialogs = () =>
  Promise.all([
    import("./holding-dialog"),
    import("./movement-dialog"),
    import("./price-dialog"),
    import("./real-estate-dialog"),
    import("./renew-dialog"),
  ]);

export const preloadCashDialogs = () =>
  Promise.all([import("./cash-entry-dialog"), import("./statement-dialog")]);
