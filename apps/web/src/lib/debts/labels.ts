import type { LiabilityKind } from "@plant/core";

export const LIABILITY_KIND_LABELS: Record<LiabilityKind, string> = {
  mortgage: "Hipotecario",
  personal_loan: "Préstamo personal",
  credit_card: "Tarjeta",
  usd_debt: "Deuda en dólares",
  crypto_loan: "Préstamo cripto",
};
