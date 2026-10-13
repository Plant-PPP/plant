"use server";

import type {
  MovementResult,
  MovementsPage,
} from "@/lib/holdings/movements-input";
import type { PriceResult } from "@/lib/holdings/price-input";
import {
  deleteManualPrice as deletePrice,
  loadMovementsPage,
  runOperation,
  setManualPrice as setPrice,
} from "@/lib/ledger/write";

// The arguments come from the browser; lib/ledger/write parses each one and
// writes as the session's user, under RLS.

export async function createOperation(input: unknown): Promise<MovementResult> {
  return runOperation("create_operation", null, input);
}

export async function updateOperation(
  operationId: unknown,
  input: unknown,
): Promise<MovementResult> {
  return runOperation("update_operation", operationId, input);
}

export async function deleteOperation(
  operationId: unknown,
): Promise<MovementResult> {
  return runOperation("delete_operation", operationId, null);
}

export async function loadMovements(
  scope: unknown,
  unit: unknown,
  cursor: unknown,
): Promise<MovementsPage> {
  return loadMovementsPage(scope, unit, cursor);
}

export async function setManualPrice(input: unknown): Promise<PriceResult> {
  return setPrice(input);
}

export async function deleteManualPrice(
  symbol: unknown,
  date: unknown,
): Promise<PriceResult> {
  return deletePrice(symbol, date);
}
