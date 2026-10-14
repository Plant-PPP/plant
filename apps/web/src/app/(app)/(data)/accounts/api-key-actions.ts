"use server";

import type {
  ConnectResult,
  DisconnectResult,
  SyncResult,
} from "@/lib/connections/api-key";
import {
  connectApiKey as connect,
  disconnectApiKey as disconnect,
  syncAccount as sync,
} from "@/lib/connections/write";

// The arguments come from the browser; lib/connections/write parses each one
// and writes as the session's user, under RLS.

export async function connectApiKey(input: unknown): Promise<ConnectResult> {
  return connect(input);
}

export async function disconnectApiKey(
  accountId: unknown,
): Promise<DisconnectResult> {
  return disconnect(accountId);
}

export async function syncAccount(
  accountId: unknown,
  draft: unknown,
): Promise<SyncResult> {
  return sync(accountId, draft);
}
