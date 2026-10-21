import "server-only";
import { LIABILITY_KINDS, liabilityInputSchema } from "@plant/core";
import { Constants } from "@plant/shared";
import { tool } from "ai";
import { z } from "zod";

import type { ProposalOutput } from "@/lib/assistant/proposals";
import { LIABILITY_KIND_LABELS } from "@/lib/debts/labels";
import {
  formatAmount,
  formatFraction,
  formatQuantity,
  percentToFraction,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { NAME_LIMITS } from "@/lib/portfolio-setup/limits";

const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .describe("Un número con punto decimal y sin separador de miles: 58480.13");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

// The debt a proposal would add, as the debts page takes it; the rate as a
// percent, the way documents print it.
const debtArgs = z.object({
  kind: z
    .enum(LIABILITY_KINDS)
    .describe(
      "personal_loan: préstamo en pesos o dólares con cuotas; mortgage: hipotecario; credit_card: tarjeta; usd_debt: deuda en dólares, también una línea de crédito en xUSD, USD o USDC (son dólares: currency USD); crypto_loan: solo un préstamo en unidades de una cripto que no es un dólar (BTC, ETH) o en USDT cuando el documento dice USDT.",
    ),
  label: z.string().min(1).max(60).describe("Un nombre corto: Préstamo Nexo."),
  lender: z.string().min(1).max(60).nullable().describe("Con quién."),
  currency: z
    .enum(Constants.public.Enums.currency)
    .nullable()
    .describe("La moneda; null para un préstamo cripto."),
  instrumentSymbol: z
    .string()
    .max(15)
    .nullable()
    .describe("Solo un préstamo cripto: el símbolo de la cripto (USDT)."),
  balance: decimal.describe("Lo que se debe hoy, intereses incluidos."),
  annualRatePercent: decimal
    .nullable()
    .describe("La tasa anual en porcentaje: 12.9 es 12,9 %."),
  accrues: z
    .boolean()
    .describe(
      "true si el interés se suma al saldo día a día hasta que se cancele (línea de crédito, préstamo sin cuotas); false si se paga en cuotas.",
    ),
  openedOn: day
    .nullable()
    .describe("El día del saldo; hoy si el documento no dice otro."),
  installment: decimal.nullable().describe("La cuota, si se paga en cuotas."),
  installmentsLeft: z.number().int().min(1).max(600).nullable(),
  nextDueOn: day.nullable(),
  maturesOn: day.nullable(),
});

const accountArgs = z.object({
  institution: z
    .string()
    .min(1)
    .max(NAME_LIMITS.source_connections.institution)
    .describe("La institución: Nexo, Roxom, Banco Galicia."),
});

const askArgs = z.object({
  question: z.string().min(1).max(200),
  options: z
    .array(z.string().min(1).max(60))
    .min(2)
    .max(4)
    .describe("De dos a cuatro respuestas cortas para elegir."),
});

// The debt a proposal's arguments make, or why they make none.
export function debtInputOf(
  args: z.infer<typeof debtArgs>,
  today: string,
): ReturnType<typeof liabilityInputSchema.safeParse> {
  const rate =
    args.annualRatePercent === null
      ? null
      : percentToFraction(args.annualRatePercent.replace(".", ","));
  return liabilityInputSchema.safeParse({
    kind: args.kind,
    label: args.label,
    lender: args.lender,
    currency: args.kind === "crypto_loan" ? null : args.currency,
    uva: false,
    instrument_symbol:
      args.kind === "crypto_loan" ? args.instrumentSymbol?.toUpperCase() : null,
    balance: args.balance,
    installment: args.accrues ? null : args.installment,
    annual_rate: rate,
    installments_left: args.accrues ? null : args.installmentsLeft,
    next_due_on: args.accrues ? null : args.nextDueOn,
    matures_on: args.maturesOn,
    accrues: args.accrues,
    opened_on: args.openedOn ?? (args.accrues ? today : null),
  });
}

// The assistant's proposals: each checks what it would write and hands back
// a card for the user to confirm, writing nothing. And its question, for
// when it is not sure what the user wants.
export function proposalTools({
  today,
  accounts,
  debts,
}: {
  today: string;
  // The user's open accounts, by institution.
  accounts: () => Promise<readonly string[]>;
  // The user's debts, by name and lender.
  debts: () => Promise<readonly { label: string; lender: string | null }[]>;
}) {
  return {
    proposeDebt: tool({
      description:
        "Propone cargar una deuda (un préstamo, una línea de crédito, una tarjeta) que el usuario mostró en un archivo o contó. No escribe nada: el usuario la confirma o descarta en una card. Llamala una vez por deuda, con los datos que se ven; si falta algo que no podés deducir, preguntá con askUser en lugar de inventarlo.",
      inputSchema: debtArgs,
      execute: async (args): Promise<ProposalOutput> => {
        const parsed = debtInputOf(args, today);
        if (!parsed.success) {
          return {
            error: `Los datos no forman una deuda válida: ${parsed.error.issues
              .map((issue) => issue.path.join(".") || issue.message)
              .join(", ")}. Corregilos o preguntale al usuario.`,
          };
        }
        const debt = parsed.data;
        const same = (await debts()).find(
          (each) =>
            each.label.toLowerCase() === debt.label.toLowerCase() ||
            (debt.lender !== null &&
              each.lender?.toLowerCase() === debt.lender.toLowerCase()),
        );
        if (same) {
          return {
            error: `El usuario ya tiene la deuda "${same.label}"${same.lender ? ` con ${same.lender}` : ""}. No la propongas de nuevo: decíselo y, si no está claro si es otra, preguntale con askUser.`,
          };
        }
        const unit = debt.instrument_symbol ?? debt.currency ?? "USD";
        const balance =
          debt.instrument_symbol !== null
            ? `${formatQuantity(debt.balance)} ${debt.instrument_symbol}`
            : formatAmount(debt.balance, unit as "ARS" | "USD" | "EUR");
        return {
          proposal: {
            title: debt.label,
            lines: [
              `${LIABILITY_KIND_LABELS[debt.kind]}${debt.lender ? ` con ${debt.lender}` : ""}`,
              `Saldo: ${balance}${debt.opened_on ? ` al ${formatDate(debt.opened_on)}` : ""}`,
              ...(debt.annual_rate !== null
                ? [
                    `Tasa: ${formatFraction(debt.annual_rate)} anual${debt.accrues ? ", se suma al saldo cada día" : ""}`,
                  ]
                : []),
              ...(debt.installment !== null
                ? [
                    `Cuota: ${formatAmount(debt.installment, unit as "ARS" | "USD" | "EUR")}${debt.installments_left ? ` · quedan ${debt.installments_left}` : ""}`,
                  ]
                : []),
            ],
          },
          input: debt,
        };
      },
    }),
    proposeAccount: tool({
      description:
        "Propone crear una cuenta (un broker, un exchange, un banco) que el usuario no tiene, antes de cargarle algo. No escribe nada: el usuario la confirma en una card.",
      inputSchema: accountArgs,
      execute: async ({ institution }): Promise<ProposalOutput> => {
        const name = institution.trim();
        const held = await accounts();
        if (held.some((each) => each.toLowerCase() === name.toLowerCase())) {
          return { error: `El usuario ya tiene la cuenta ${name}.` };
        }
        return {
          proposal: { title: name, lines: ["Cuenta nueva"] },
          input: { institution: name },
        };
      },
    }),
    askUser: tool({
      description:
        "Le pregunta algo al usuario con opciones para elegir, cuando no sabés qué quiere o falta un dato que no podés deducir (en qué cuenta entró, si es un préstamo o un depósito). Después de preguntar, terminá tu respuesta y esperá la suya.",
      inputSchema: askArgs,
      execute: async ({ question, options }) => ({
        question: { text: question, options },
      }),
    }),
  };
}
