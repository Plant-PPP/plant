import { fromScaled, toScaled } from "@plant/shared";
import {
  type Installment,
  type InstallmentPlan,
  installmentPlan,
  type LiabilityEvent,
} from "@plant/core";

// A debt's plan as its recorded payments cover it.
export const planOf = (
  installments: readonly Installment[],
  events: readonly LiabilityEvent[],
): InstallmentPlan =>
  installmentPlan(
    installments,
    events.flatMap((event) =>
      event.kind === "payment" ? [{ amount: event.amount }] : [],
    ),
  );

// The plan of each debt that has one, by debt.
export function debtPlans(
  installments: ReadonlyMap<string, readonly Installment[]>,
  events: ReadonlyMap<string, readonly LiabilityEvent[]>,
): Record<string, InstallmentPlan> {
  return Object.fromEntries(
    [...installments]
      .filter(([, plan]) => plan.length > 0)
      .map(([id, plan]) => [id, planOf(plan, events.get(id) ?? [])]),
  );
}

// What each debt's recorded payments add up to, by debt.
export function paidByDebt(
  events: ReadonlyMap<string, readonly LiabilityEvent[]>,
): Record<string, string> {
  return Object.fromEntries(
    [...events].map(([id, each]) => [
      id,
      fromScaled(
        each.reduce(
          (sum, event) =>
            event.kind === "payment" ? sum + toScaled(event.amount) : sum,
          0n,
        ),
      ),
    ]),
  );
}
