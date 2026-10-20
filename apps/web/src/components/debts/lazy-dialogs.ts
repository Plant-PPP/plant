"use client";

import dynamic from "next/dynamic";

// The debts pages' dialogs, each in a chunk of its own: a page shows without
// them and loads them once idle (preloadDebtDialogs).
export const DebtDialog = dynamic(
  () => import("./debt-dialog").then((module) => module.DebtDialog),
  { ssr: false },
);
export const DebtEventDialog = dynamic(
  () => import("./debt-event-dialog").then((module) => module.DebtEventDialog),
  { ssr: false },
);
export const DebtCollateralDialog = dynamic(
  () =>
    import("./debt-collateral-dialog").then(
      (module) => module.DebtCollateralDialog,
    ),
  { ssr: false },
);

export const preloadDebtDialogs = () =>
  Promise.all([
    import("./debt-dialog"),
    import("./debt-event-dialog"),
    import("./debt-collateral-dialog"),
  ]);
