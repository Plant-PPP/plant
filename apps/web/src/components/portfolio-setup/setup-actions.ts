"use client";

import { useOptimistic, useTransition } from "react";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { settle } from "@/lib/server-action-call";
import type { Answer } from "./answers";
import {
  type SetupChange,
  type SetupLists,
  applySetupChange,
} from "./list-change";

export type SetupRun = ReturnType<typeof useSetupActions>["run"];

// The accounts page's lists as the user should see them, and the one write the
// page runs at a time. A change shows at once; when the write ends, the page's
// refresh replaces it, or the lists go back if it was refused.
export function useSetupActions(views: SetupLists) {
  const [lists, setOptimistic] = useOptimistic(views, applySetupChange);
  const [pending, startTransition] = useTransition();

  function run(
    change: SetupChange,
    call: () => Promise<WriteResult>,
    answerOf: (result: WriteResult | "rejected") => Answer,
    after: (answer: Answer) => void,
  ): boolean {
    if (pending) return false;
    startTransition(async () => {
      setOptimistic(change);
      const answer = answerOf(await settle(call()));
      // React drops the transition after an await; wrapped again, these
      // updates commit together with the refresh or the rollback.
      startTransition(() => after(answer));
    });
    return true;
  }

  return { lists, pending, run };
}
