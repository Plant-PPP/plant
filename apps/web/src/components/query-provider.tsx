"use client";

import {
  isServer,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // What the browser asked the server for stays fresh this long: going
        // back to it shows it at once.
        staleTime: 30_000,
        // A server action that failed answers the same on a second try.
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

let browserClient: QueryClient | undefined;

// One cache per browser tab; a server render gets its own, never shared
// between users.
function queryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  return (browserClient ??= makeQueryClient());
}

// The cache of what the browser reads from the server after the page loads.
export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient()}>{children}</QueryClientProvider>
  );
}
