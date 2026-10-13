"use server";

import { writeLiability } from "@/lib/debts/write";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

// The arguments come from the browser; lib/debts/write parses each one and
// writes as the session's user, under RLS.

export async function createDebt(input: unknown): Promise<WriteResult> {
  return writeLiability("create_liability", null, input);
}

export async function updateDebt(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return writeLiability("update_liability", id, input);
}

export async function deleteDebt(id: unknown): Promise<WriteResult> {
  return writeLiability("delete_liability", id, null);
}
