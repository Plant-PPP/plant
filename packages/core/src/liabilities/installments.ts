import { fromScaled, positiveDecimalSchema, toScaled } from "@plant/shared";
import { z } from "zod";

import { holdingDateSchema } from "../valuation/holding";

export const INSTALLMENTS_MAX = 600;

export const installmentSchema = z
  .object({ due_on: holdingDateSchema, amount: positiveDecimalSchema })
  .strict();
export type Installment = z.output<typeof installmentSchema>;

export const installmentsInputSchema = z
  .array(installmentSchema)
  .max(INSTALLMENTS_MAX);

export type InstallmentStatus = "paid" | "partial" | "pending";

export type PlannedInstallment = Installment & {
  status: InstallmentStatus;
  // What is still owed of this installment.
  owed: string;
};

export type InstallmentPlan = {
  installments: PlannedInstallment[];
  next: PlannedInstallment | null;
};

// The debt's recorded payments cover its installments in date order: an
// installment is paid once the payments reach every amount due up to it.
export function installmentPlan(
  installments: readonly Installment[],
  payments: readonly { amount: string }[],
): InstallmentPlan {
  let left = payments.reduce((sum, p) => sum + toScaled(p.amount), 0n);
  const planned = installments
    .map((installment, index) => ({ installment, index }))
    .sort(
      (a, b) =>
        (a.installment.due_on < b.installment.due_on
          ? -1
          : a.installment.due_on > b.installment.due_on
            ? 1
            : 0) || a.index - b.index,
    )
    .map(({ installment }): PlannedInstallment => {
      const amount = toScaled(installment.amount);
      const covered = left >= amount ? amount : left;
      left -= covered;
      const status: InstallmentStatus =
        covered === amount ? "paid" : covered > 0n ? "partial" : "pending";
      return { ...installment, status, owed: fromScaled(amount - covered) };
    });
  return {
    installments: planned,
    next: planned.find((installment) => installment.status !== "paid") ?? null,
  };
}

// `count` installments of `amount`, one every `everyMonths` months from start,
// keeping start's day of month or the month's last day when shorter.
export function installmentSeries(
  start: string,
  count: number,
  everyMonths: number,
  amount: string,
): Installment[] {
  const [year, month, day] = start.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return Array.from({ length: count }, (_, i) => {
    const months = month - 1 + i * everyMonths;
    const y = year + Math.floor(months / 12);
    const m = months % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(y, m, Math.min(day, last)));
    return { due_on: due.toISOString().slice(0, 10), amount };
  });
}
