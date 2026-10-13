"use server";

import type { MovementResult } from "@/lib/holdings/movements-input";
import { confirmImportRows as confirmRows } from "@/lib/imports/confirm-write";
import {
  acceptTerms as accept,
  type FinishResult,
  finishUpload as finish,
  type StartResult,
  startUpload as start,
} from "@/lib/imports/write";

// The arguments come from the browser; lib/imports/write parses each one and
// writes as the session's user, under RLS.

export async function startUpload(input: unknown): Promise<StartResult> {
  return start(input);
}

export async function finishUpload(input: unknown): Promise<FinishResult> {
  return finish(input);
}

export async function acceptTerms(): Promise<{ ok: boolean }> {
  return accept();
}

export async function confirmImport(
  importId: unknown,
  rows: unknown,
): Promise<MovementResult> {
  return confirmRows(importId, rows);
}
