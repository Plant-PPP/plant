"use server";

import type { CashResult, StatementResult } from "@/lib/cash/input";
import { importStatement, writeCash } from "@/lib/cash/write";

// The arguments come from the browser and are parsed before any write.

export async function writeAccountCash(input: unknown): Promise<CashResult> {
  return writeCash(input);
}

export async function importAccountStatement(
  input: unknown,
): Promise<StatementResult> {
  return importStatement(input);
}
