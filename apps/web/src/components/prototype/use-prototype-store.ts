"use client";

import { useRef, useState } from "react";

import type { PrototypeState, Write } from "./prototype-store";

// The prototype's state and the one way to change it: a write reads the
// latest state, not the last render's, so writes in a row each see the one
// before. The state is set before the action's promise settles, inside the
// transition that awaits it, as a server action's refresh would be.
export function usePrototypeStore(initial: () => PrototypeState) {
  const [state, setState] = useState(initial);
  const latest = useRef(state);

  async function write<R>(change: (state: PrototypeState) => Write<R>) {
    const next = change(latest.current);
    latest.current = next.state;
    setState(next.state);
    return next.result;
  }

  return { state, latest, write };
}
