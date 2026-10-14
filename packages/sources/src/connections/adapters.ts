import { z } from "zod";

import { binanceConnection } from "./binance";
import { ibkrConnection } from "./ibkr";
import { iolConnection } from "./iol";
import { nexoConnection } from "./nexo";
import type { ConnectionDeps, ConnectionProviderPort } from "./port";
import { wallbitConnection } from "./wallbit";

// Every provider an account may connect by API, each by its adapter. Adding
// one is its adapter and its line here (and its copy in the web app's
// registry, which the typecheck asks for).
const ADAPTERS = {
  binance: binanceConnection,
  wallbit: wallbitConnection,
  ibkr: ibkrConnection,
  nexo: nexoConnection,
  iol: iolConnection,
} satisfies Record<string, (deps?: ConnectionDeps) => ConnectionProviderPort>;

export type ConnectionProvider = keyof typeof ADAPTERS;

export const CONNECTION_PROVIDERS = Object.keys(ADAPTERS) as [
  ConnectionProvider,
  ...ConnectionProvider[],
];

export const connectionProviderSchema = z.enum(CONNECTION_PROVIDERS);

export type ConnectionAdapters = Record<
  ConnectionProvider,
  () => ConnectionProviderPort
>;

// Each provider's adapter against its real API; `deps` swaps how they reach
// it, for tests.
export function connectionAdapters(
  deps: Omit<ConnectionDeps, "baseUrl"> = {},
): ConnectionAdapters {
  return Object.fromEntries(
    CONNECTION_PROVIDERS.map((provider) => [
      provider,
      () => ADAPTERS[provider](deps),
    ]),
  ) as ConnectionAdapters;
}
