"use client";

import { createContext, type ReactNode, useContext } from "react";

import type { ChartPart, PinResult } from "@/lib/assistant/chat";

// How a page pins an answer's chart to Resumen, and which charts it can pin;
// none where charts are not pinned.
type Pin = {
  pin: (chart: ChartPart) => Promise<PinResult>;
  pins: (chart: ChartPart) => boolean;
};

export const PinContext = createContext<Pin | null>(null);

export const usePin = () => useContext(PinContext);

// Pins by which of the assistant's charts it is, through a server action;
// a chart that does not say which, as one kept from before, cannot be pinned.
export function SourcePinProvider({
  action,
  children,
}: {
  action: (source: unknown) => Promise<PinResult>;
  children: ReactNode;
}) {
  return (
    <PinContext.Provider
      value={{
        pin: (chart) =>
          chart.source ? action(chart.source) : Promise.resolve("failed"),
        pins: (chart) => chart.source !== undefined,
      }}
    >
      {children}
    </PinContext.Provider>
  );
}
