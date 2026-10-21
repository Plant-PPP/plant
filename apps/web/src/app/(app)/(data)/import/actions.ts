"use server";

import { getSessionClaims } from "@/lib/auth/session-claims";
import type { MovementResult } from "@/lib/holdings/movements-input";
import {
  confirmImportDebts as confirmDebts,
  confirmImportOperations as confirmOperations,
  confirmImportRows as confirmRows,
} from "@/lib/imports/confirm-write";
import {
  type AccountResult,
  acceptTerms as accept,
  assignImportAccount as assign,
  type DiscardResult,
  discardImport as discard,
  type FinishResult,
  finishUpload as finish,
  type StartResult,
  startUpload as start,
} from "@/lib/imports/write";
import { requestQuotes } from "@/lib/quotes/request-quotes";

// The arguments come from the browser; lib/imports/write parses each one and
// writes as the session's user, under RLS.

export async function startUpload(input: unknown): Promise<StartResult> {
  return start(input);
}

export async function finishUpload(input: unknown): Promise<FinishResult> {
  return finish(input);
}

export async function assignImportAccount(
  input: unknown,
): Promise<AccountResult> {
  return assign(input);
}

export async function discardImport(importId: unknown): Promise<DiscardResult> {
  return discard(importId);
}

export async function acceptTerms(): Promise<{ ok: boolean }> {
  return accept();
}

export async function confirmImport(
  importId: unknown,
  rows: unknown,
  heldCash: unknown,
): Promise<MovementResult> {
  return quoted(await confirmRows(importId, rows, heldCash));
}

export async function confirmImportOperations(
  importId: unknown,
  rows: unknown,
): Promise<MovementResult & { rowId?: string }> {
  return quoted(await confirmOperations(importId, rows));
}

export async function confirmImportDebts(
  importId: unknown,
  rows: unknown,
): Promise<MovementResult> {
  return confirmDebts(importId, rows);
}

// A confirmed import may bring a symbol with no price yet.
async function quoted<R extends { ok: boolean }>(result: R): Promise<R> {
  if (result.ok) await requestQuotes((await getSessionClaims()).sub);
  return result;
}
