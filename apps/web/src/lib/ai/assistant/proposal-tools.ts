import "server-only";
import {
  LIABILITY_KINDS,
  liabilityInputSchema,
  principalSplit,
} from "@plant/core";
import { Constants, fromScaled, toScaled } from "@plant/shared";
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
  principal: decimal
    .nullable()
    .describe(
      "El capital pedido si el documento lo separa de los intereses (Capital 54719.05).",
    ),
  accruedInterest: decimal
    .nullable()
    .describe(
      "Los intereses acumulados si el documento los muestra (Intereses acumulados 3782.04).",
    ),
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

const currency = z.enum(Constants.public.Enums.currency);
const symbol = z
  .string()
  .min(1)
  .max(30)
  .describe("El símbolo como figura: BTC, NVDA, AL30, USD.");
const account = z
  .string()
  .min(1)
  .max(NAME_LIMITS.source_connections.institution)
  .describe("El nombre exacto de una cuenta que el usuario ya tiene.");

const holdingsArgs = z.object({
  account,
  rows: z
    .array(
      z.object({
        symbol,
        quantity: decimal.describe("La cantidad que tiene hoy."),
        currency: currency.describe(
          "La moneda en que cotiza o, para un saldo, la del saldo.",
        ),
        cash: z
          .boolean()
          .describe(
            "true solo para un saldo en una moneda (USD, EUR, ARS); USDT, USDC y las demás cripto son false.",
          ),
        price: decimal.nullable().describe("El precio por unidad si se ve."),
        cost: decimal.nullable().describe("Lo que costó en total si se ve."),
      }),
    )
    .min(1)
    .max(200),
});

const OPERATION_KINDS = [
  "purchase",
  "sale",
  "dividend",
  "coupon",
  "adjustment",
] as const;

const operationsArgs = z.object({
  account,
  rows: z
    .array(
      z.object({
        date: day.nullable(),
        kind: z
          .enum(OPERATION_KINDS)
          .describe(
            "purchase: compra; sale: venta; dividend y coupon: cobro; adjustment: un depósito o retiro de unidades que no fue compra ni venta.",
          ),
        symbol,
        quantity: decimal.nullable(),
        price: decimal.nullable().describe("El precio por unidad."),
        amount: decimal
          .nullable()
          .describe("Lo cobrado, para un dividendo o cupón."),
        charges: decimal.nullable().describe("Comisiones e impuestos."),
        currency,
      }),
    )
    .min(1)
    .max(200),
});

const KIND_WORDS: Record<(typeof OPERATION_KINDS)[number], string> = {
  purchase: "Compra",
  sale: "Venta",
  dividend: "Dividendo",
  coupon: "Cupón",
  adjustment: "Ajuste",
};

// A card shows this many rows, and how many more there are.
const SHOWN_ROWS = 8;
const capped = (lines: string[]): string[] =>
  lines.length > SHOWN_ROWS
    ? [...lines.slice(0, SHOWN_ROWS), `y ${lines.length - SHOWN_ROWS} más`]
    : lines;

type Account = { id: string; institution: string };

// The one open account of that name, or why there is none to load into.
function accountNamed(
  held: readonly Account[],
  name: string,
): Account | { error: string } {
  const matches = held.filter(
    (each) => each.institution.toLowerCase() === name.trim().toLowerCase(),
  );
  if (matches.length === 1) return matches[0]!;
  return matches.length === 0
    ? {
        error: `El usuario no tiene la cuenta "${name}". Si la tiene que crear, proponela con proposeAccount y esperá que la confirme; si es otra, preguntale con askUser.`,
      }
    : {
        error: `El usuario tiene varias cuentas "${name}": preguntale con askUser en cuál.`,
      };
}

const askArgs = z.object({
  question: z.string().min(1).max(200),
  options: z
    .array(z.string().min(1).max(60))
    .min(2)
    .max(4)
    .describe("De dos a cuatro respuestas cortas para elegir."),
});

// The principal as printed, or else the balance less the printed interest
// when that leaves something: the model's own arithmetic is never used.
function principalOf(args: z.infer<typeof debtArgs>): string | null {
  if (args.principal !== null) return args.principal;
  if (args.accruedInterest === null) return null;
  const rest = toScaled(args.balance) - toScaled(args.accruedInterest);
  return rest > 0n ? fromScaled(rest) : null;
}

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
    principal: principalOf(args),
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
  // The user's open accounts.
  accounts: () => Promise<readonly Account[]>;
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
        const amount = (value: string) =>
          debt.instrument_symbol !== null
            ? `${formatQuantity(value)} ${debt.instrument_symbol}`
            : formatAmount(value, unit as "ARS" | "USD" | "EUR");
        const balance = amount(debt.balance);
        const split = principalSplit(debt.balance, debt.principal);
        return {
          proposal: {
            title: debt.label,
            lines: [
              `${LIABILITY_KIND_LABELS[debt.kind]}${debt.lender ? ` con ${debt.lender}` : ""}`,
              `Saldo: ${balance}${debt.opened_on ? ` al ${formatDate(debt.opened_on)}` : ""}`,
              ...(split
                ? [
                    `Capital: ${amount(split.principal)} · Intereses: ${amount(split.interest)}`,
                  ]
                : []),
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
        if (
          held.some(
            (each) => each.institution.toLowerCase() === name.toLowerCase(),
          )
        ) {
          return { error: `El usuario ya tiene la cuenta ${name}.` };
        }
        return {
          proposal: { title: name, lines: ["Cuenta nueva"] },
          input: { institution: name },
        };
      },
    }),
    proposeHoldings: tool({
      description:
        "Propone cargar las tenencias de hoy de una cuenta que el usuario ya tiene (lo que muestra una captura de saldos o de cartera). No escribe nada: si la confirma, el usuario la revisa en Cargar y la carga desde ahí. Una sola llamada con todas las filas de la cuenta.",
      inputSchema: holdingsArgs,
      execute: async (args): Promise<ProposalOutput> => {
        const target = accountNamed(await accounts(), args.account);
        if ("error" in target) return target;
        const rows = args.rows.map((row) => ({
          symbol: row.symbol.toUpperCase(),
          quantity: row.quantity,
          currency: row.currency,
          asset_class: row.cash ? "cash" : "instrument",
          price: row.cash ? null : row.price,
          cost: row.cash ? null : row.cost,
        }));
        return {
          proposal: {
            title: `Tenencias en ${target.institution}`,
            lines: capped(
              rows.map((row) =>
                row.asset_class === "cash"
                  ? `Saldo: ${formatAmount(row.quantity, row.currency)}`
                  : `${formatQuantity(row.quantity)} ${row.symbol}${row.price ? ` a ${formatAmount(row.price, row.currency)}` : ""}`,
              ),
            ),
          },
          input: { accountId: target.id, rows },
        };
      },
    }),
    proposeOperations: tool({
      description:
        "Propone cargar operaciones (compras, ventas, cobros, depósitos de unidades) de una cuenta que el usuario ya tiene. No escribe nada: si la confirma, el usuario las revisa en Cargar y las carga desde ahí. Una sola llamada con todas las operaciones de la cuenta.",
      inputSchema: operationsArgs,
      execute: async (args): Promise<ProposalOutput> => {
        const target = accountNamed(await accounts(), args.account);
        if ("error" in target) return target;
        const rows = args.rows.map((row) => ({
          ...row,
          symbol: row.symbol.toUpperCase(),
        }));
        return {
          proposal: {
            title: `Operaciones en ${target.institution}`,
            lines: capped(
              rows.map(
                (row) =>
                  `${row.date ? `${formatDate(row.date)} · ` : ""}${KIND_WORDS[row.kind]} ${
                    row.quantity ? `${formatQuantity(row.quantity)} ` : ""
                  }${row.symbol}${
                    row.amount
                      ? ` por ${formatAmount(row.amount, row.currency)}`
                      : row.price
                        ? ` a ${formatAmount(row.price, row.currency)}`
                        : ""
                  }`,
              ),
            ),
          },
          input: { accountId: target.id, rows },
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
