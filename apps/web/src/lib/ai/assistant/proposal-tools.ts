import "server-only";
import {
  INSTALLMENTS_MAX,
  installmentsInputSchema,
  LIABILITY_KINDS,
  liabilityInputSchema,
  principalSplit,
} from "@plant/core";
import { Constants, fromScaled, toScaled } from "@plant/shared";
import { OPERATION_KINDS } from "@plant/sources";
import { tool } from "ai";
import { z } from "zod";

import type { ProposalOutput } from "@/lib/assistant/proposals";
import { debtsNamed } from "@/lib/imports/debts-review";
import { reviewKindOf } from "@/lib/imports/operations-review";
import { LIABILITY_KIND_LABELS } from "@/lib/debts/labels";
import {
  formatAmount,
  formatFraction,
  formatQuantity,
  percentToFraction,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { holdingInsertSchema } from "@/lib/holdings/schemas";
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
  installments: z
    .array(z.object({ dueOn: day, amount: decimal }))
    .max(INSTALLMENTS_MAX)
    .nullable()
    .describe(
      "El plan de cuotas que quedan por pagar, cada una con su fecha y monto, cuando las cuotas no son todas iguales (3160 el 2026-10-31, 8160 el 2026-11-30, 6 semestrales de 4080). Solo lo que falta pagar.",
    ),
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

const operationsArgs = z.object({
  account,
  rows: z
    .array(
      z.object({
        date: day.nullable(),
        kind: z
          .enum([...OPERATION_KINDS, "transfer", "debt_payment"])
          .describe(
            "purchase: compra; sale: venta; dividend y coupon: cobro; adjustment: unidades que entraron (un depósito desde afuera, un préstamo recibido) o salieron (un retiro hacia afuera, una comisión cobrada en la cripto) sin compra ni venta; transfer: unidades enviadas a otra cuenta del usuario; debt_payment: el pago de un préstamo o línea de crédito. Nunca propongas un colateral ni un movimiento entre subcuentas (funding, trading).",
          ),
        direction: z
          .enum(["in", "out"])
          .nullable()
          .describe(
            "Solo para adjustment: in si las unidades entraron a la cuenta, out si salieron.",
          ),
        toAccount: account
          .nullable()
          .describe(
            "Solo para transfer: el nombre exacto de la otra cuenta del usuario adonde fueron.",
          ),
        debt: z
          .string()
          .min(1)
          .max(60)
          .nullable()
          .describe(
            "Solo para debt_payment: el nombre o el prestamista de la deuda que paga, como figura en sus deudas.",
          ),
        fromAccount: z
          .boolean()
          .nullable()
          .describe(
            "Solo para debt_payment: true si el pago salió de esta cuenta (sus unidades o su efectivo), false si el documento solo muestra la deuda pagada.",
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

// A card shows this many rows, and how many more there are.
const SHOWN_ROWS = 8;
const capped = (lines: string[]): string[] =>
  lines.length > SHOWN_ROWS
    ? [...lines.slice(0, SHOWN_ROWS), `y ${lines.length - SHOWN_ROWS} más`]
    : lines;

type Account = {
  id: string;
  institution: string;
  default_portfolio_id: string;
};

// A debt of the user's, as a proposal names it.
type Debt = { id: string; kind: string; label: string; lender: string | null };

const realEstateArgs = z.object({
  account: account
    .nullable()
    .describe(
      "El nombre exacto de la cuenta donde va; null para la cuenta Inmuebles.",
    ),
  label: z
    .string()
    .min(1)
    .max(NAME_LIMITS.holdings.label)
    .describe("Un nombre corto: Cochera Palermo."),
  amount: decimal.describe("Lo que vale, según el usuario."),
  currency,
  valuedOn: day.nullable().describe("El día de esa valuación; null es hoy."),
  cost: decimal
    .nullable()
    .describe(
      "Lo que le costó al usuario, financiación incluida, si es distinto del valor: precio financiado 40800. null si no lo sabés.",
    ),
});

const PROPERTIES_ACCOUNT = "Inmuebles";

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

// An operation as stage_assistant_import takes it.
type StagedOperation = {
  date: string | null;
  kind: (typeof OPERATION_KINDS)[number] | "transfer" | null;
  direction: "in" | "out" | null;
  counterpart_connection_id: string | null;
  debt_payment: boolean;
  pays_liability_id: string | null;
  symbol: string | null;
  quantity: string | null;
  price: string | null;
  amount: string | null;
  charges: string | null;
  currency: z.infer<typeof currency>;
};

// A proposed operation as the draft keeps it, its account or debt named as
// one of the user's (`named`, for the card), or why it names none.
function stagedOperationOf(
  row: z.infer<typeof operationsArgs>["rows"][number],
  target: Account,
  held: readonly Account[],
  payable: readonly Debt[],
): { staged: StagedOperation; named?: string } | { error: string } {
  const common = {
    date: row.date,
    counterpart_connection_id: null,
    debt_payment: false,
    pays_liability_id: null,
    symbol: row.symbol.toUpperCase(),
    quantity: row.quantity,
    price: row.price,
    amount: row.amount,
    charges: row.charges,
    currency: row.currency,
  };
  if (row.kind === "transfer") {
    if (!row.toAccount) {
      return {
        error:
          "Un traspaso necesita toAccount, la otra cuenta del usuario adonde fueron las unidades. Si no la sabés, preguntale con askUser.",
      };
    }
    const to = accountNamed(held, row.toAccount);
    if ("error" in to) return to;
    if (to.id === target.id) {
      return {
        error:
          "Un traspaso va a otra cuenta, no a la misma. Si salieron de la cuenta hacia afuera, es un adjustment con direction out.",
      };
    }
    return {
      staged: {
        ...common,
        kind: "transfer",
        direction: "out",
        counterpart_connection_id: to.id,
      },
      named: `a ${to.institution}`,
    };
  }
  if (row.kind === "debt_payment") {
    const named = row.debt ? debtsNamed([row.debt], payable) : [];
    if (named.length !== 1) {
      return {
        error:
          named.length === 0
            ? `El usuario no tiene una deuda "${row.debt ?? ""}" que no sea una tarjeta. Si tiene que cargarla, proponela con proposeDebt; si es otra, preguntale con askUser.`
            : `El usuario tiene varias deudas "${row.debt}": preguntale con askUser cuál pagó.`,
      };
    }
    const debt = named[0]!;
    return {
      staged: {
        ...common,
        kind: row.fromAccount ? "adjustment" : null,
        direction: row.fromAccount ? "out" : null,
        debt_payment: true,
        pays_liability_id: debt.id,
      },
      named: `de ${debt.label}`,
    };
  }
  return {
    staged: {
      ...common,
      kind: row.kind,
      direction: row.kind === "adjustment" ? (row.direction ?? "in") : null,
    },
  };
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
  debts: () => Promise<readonly Debt[]>;
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
        const plan = (args.installments ?? [])
          .map((each) => ({ due_on: each.dueOn, amount: each.amount }))
          .sort((x, y) => x.due_on.localeCompare(y.due_on));
        if (!installmentsInputSchema.safeParse(plan).success) {
          return {
            error:
              "El plan de cuotas no es válido: cada cuota necesita una fecha YYYY-MM-DD y un monto mayor a cero.",
          };
        }
        const planTotal = plan.reduce(
          (sum, each) => sum + toScaled(each.amount),
          0n,
        );
        if (plan.length > 0 && planTotal !== toScaled(debt.balance)) {
          return {
            error: `Las cuotas suman ${fromScaled(planTotal)} y el saldo es ${debt.balance}: el saldo tiene que ser lo que falta pagar, la suma de las cuotas. Corregí uno de los dos.`,
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
              ...(plan.length > 0
                ? [
                    `Plan: ${plan.length} cuotas · próxima ${amount(plan[0]!.amount)} el ${formatDate(plan[0]!.due_on)}`,
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
          ...(plan.length > 0 && { installments: plan }),
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
        "Propone cargar operaciones (compras, ventas, cobros, depósitos y retiros de unidades, traspasos a otra cuenta del usuario, pagos de una deuda) de una cuenta que el usuario ya tiene. No escribe nada: si la confirma, el usuario las revisa en Cargar y las carga desde ahí. Una sola llamada con todas las operaciones de la cuenta.",
      inputSchema: operationsArgs,
      execute: async (args): Promise<ProposalOutput> => {
        const held = await accounts();
        const target = accountNamed(held, args.account);
        if ("error" in target) return target;
        const payable = args.rows.some((row) => row.kind === "debt_payment")
          ? (await debts()).filter((debt) => debt.kind !== "credit_card")
          : [];
        const rows: { staged: StagedOperation; named?: string }[] = [];
        for (const row of args.rows) {
          const read = stagedOperationOf(row, target, held, payable);
          if ("error" in read) return read;
          rows.push(read);
        }
        return {
          proposal: {
            title: `Operaciones en ${target.institution}`,
            lines: capped(
              rows.map(({ staged: row, named }) => {
                const kind = reviewKindOf({
                  kind: row.kind,
                  direction: row.direction,
                  debtPayment: row.debt_payment,
                });
                const where = named ? ` ${named}` : "";
                return `${row.date ? `${formatDate(row.date)} · ` : ""}${kind?.label ?? "Operación"} ${
                  row.quantity ? `${formatQuantity(row.quantity)} ` : ""
                }${row.symbol ?? ""}${where}${
                  row.amount
                    ? ` por ${formatAmount(row.amount, row.currency)}`
                    : row.price
                      ? ` a ${formatAmount(row.price, row.currency)}`
                      : ""
                }`.replace(/\s+/g, " ");
              }),
            ),
          },
          input: {
            accountId: target.id,
            rows: rows.map(({ staged }) => staged),
          },
        };
      },
    }),
    proposeRealEstate: tool({
      description:
        "Propone cargar un inmueble (casa, departamento, cochera, terreno) con el valor que dice el usuario. No escribe nada: el usuario lo confirma o descarta en una card. Va en una cuenta que el usuario ya tiene; sin cuenta, en Inmuebles.",
      inputSchema: realEstateArgs,
      execute: async (args): Promise<ProposalOutput> => {
        const held = await accounts();
        const named = args.account ? accountNamed(held, args.account) : null;
        const target =
          named && !("error" in named)
            ? named
            : accountNamed(held, PROPERTIES_ACCOUNT);
        if ("error" in target) {
          return {
            error: `No hay una cuenta para el inmueble. Proponé la cuenta "${PROPERTIES_ACCOUNT}" con proposeAccount y esperá que el usuario la confirme antes de proponer el inmueble.`,
          };
        }
        const parsed = holdingInsertSchema.safeParse({
          asset_class: "real_estate",
          source_connection_id: target.id,
          portfolio_id: target.default_portfolio_id,
          instrument_symbol: null,
          currency: args.currency,
          amount: args.amount,
          annual_rate: null,
          started_on: null,
          matures_on: null,
          valued_on: args.valuedOn ?? today,
          label: args.label,
          cost: args.cost,
        });
        if (!parsed.success || parsed.data.asset_class !== "real_estate") {
          return {
            error: `Los datos no forman un inmueble válido: ${
              parsed.success
                ? "asset_class"
                : parsed.error.issues
                    .map((issue) => issue.path.join(".") || issue.message)
                    .join(", ")
            }. Corregilos o preguntale al usuario.`,
          };
        }
        const holding = parsed.data;
        return {
          proposal: {
            title: holding.label,
            lines: [
              `Inmueble en ${target.institution}`,
              `Valor: ${formatAmount(holding.amount, holding.currency)} al ${formatDate(holding.valued_on)}`,
              ...(holding.cost
                ? [`Costo: ${formatAmount(holding.cost, holding.currency)}`]
                : []),
            ],
          },
          input: holding,
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
