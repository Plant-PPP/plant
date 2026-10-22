"use server";

import {
  type DebtEventResult,
  writeLiabilityEvent,
} from "@/lib/debts/events-write";
import { writeCollateral } from "@/lib/debts/collateral-write";
import { writeDisbursement } from "@/lib/debts/disbursement-write";
import { writeInstallments } from "@/lib/debts/installments-write";
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

export async function recordDebtEvent(
  debtId: unknown,
  event: unknown,
  cash: unknown,
): Promise<DebtEventResult> {
  return writeLiabilityEvent({
    action: "record_liability_event",
    debtId,
    event,
    cash,
  });
}

export async function updateDebtEvent(
  eventId: unknown,
  event: unknown,
  cash: unknown,
): Promise<DebtEventResult> {
  return writeLiabilityEvent({
    action: "update_liability_event",
    eventId,
    event,
    cash,
  });
}

export async function deleteDebtEvent(
  eventId: unknown,
): Promise<DebtEventResult> {
  return writeLiabilityEvent({ action: "delete_liability_event", eventId });
}

export async function setDebtCollateral(
  debtId: unknown,
  holdingIds: unknown,
): Promise<WriteResult> {
  return writeCollateral(debtId, holdingIds);
}

export async function setDebtDisbursement(
  debtId: unknown,
  operationId: unknown,
): Promise<WriteResult> {
  return writeDisbursement(debtId, operationId);
}

export async function setDebtInstallments(
  debtId: unknown,
  installments: unknown,
): Promise<WriteResult> {
  return writeInstallments(debtId, installments);
}
