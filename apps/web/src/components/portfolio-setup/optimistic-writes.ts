"use client";

import { useOptimistic, useTransition } from "react";
import { settle } from "@/lib/server-action-call";
import type { Answer } from "./answers";

// A write's answer: done, or refused with a code its section has a message
// for.
export type Result<Code extends string = string> =
  { ok: true } | { ok: false; code: Code };

export type OptimisticRun<C> = <R extends Result>(
  change: C,
  call: () => Promise<R>,
  answerOf: (result: R | "rejected") => Answer,
  after: (answer: Answer) => void,
) => boolean;

// A page's state as the user should see it, and the one write the page runs
// at a time. A change shows at once; when the write ends, the page's refresh
// replaces it, or the state goes back if it was refused. run is false while
// another write runs.
export function useOptimisticWrites<S, C>(
  state: S,
  apply: (state: S, change: C) => S,
) {
  const [shown, setOptimistic] = useOptimistic(state, apply);
  const [pending, startTransition] = useTransition();

  const run: OptimisticRun<C> = (change, call, answerOf, after) => {
    if (pending) return false;
    startTransition(async () => {
      setOptimistic(change);
      const answer = answerOf(await settle(call()));
      // React drops the transition after an await; wrapped again, these
      // updates commit together with the refresh or the rollback.
      startTransition(() => after(answer));
    });
    return true;
  };

  return { shown, pending, run };
}
