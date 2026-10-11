"use client";

import {
  type SetupChange,
  type SetupLists,
  applySetupChange,
} from "./list-change";
import { type OptimisticRun, useOptimisticWrites } from "./optimistic-writes";

export type SetupRun = OptimisticRun<SetupChange>;

// The accounts page's lists as the user should see them, and the one write it
// runs at a time.
export function useSetupActions(views: SetupLists) {
  const { shown, pending, run } = useOptimisticWrites(views, applySetupChange);
  return { lists: shown, pending, run };
}
