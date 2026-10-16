import "server-only";
import { tool } from "ai";
import { z } from "zod";

import { CHAT_UNITS } from "@/lib/assistant/chat";
import {
  SCENARIO_CHANGE,
  SCENARIO_DOLLARS,
  pairedScenario,
  validChange,
} from "@/lib/assistant/scenario";
import {
  type AssistantData,
  CHART_TOPICS,
  type ToolFailure,
} from "@/lib/assistant/tools-data";
import type { LogFields } from "@plant/shared";

import { errorType, serverLog } from "@/lib/log/server-log";

const portfolio = z
  .string()
  .max(60)
  .optional()
  .describe("El nombre o el id de una cartera del usuario; sin ella, todas.");

const instrument = z
  .string()
  .min(1)
  .max(60)
  .describe("El símbolo (AAPL, AL30, BTC) o el nombre de un instrumento.");

const percent = z
  .string()
  .regex(SCENARIO_CHANGE)
  .refine(validChange)
  .describe(
    "Cuánto se mueve, en porcentaje con punto decimal: 10 sube un 10 %, -15.5 baja un 15,5 %. Entre -99.99 y 1000.",
  );

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// The assistant's read-only tools over one user's data. A read that fails
// answers read_failed, and the turn goes on.
export function assistantTools(
  data: AssistantData,
  // What every line of the turn carries: the user, the request and the
  // conversation.
  logFields: LogFields,
  onFailure: () => void,
) {
  const guarded =
    <A extends unknown[], R>(name: string, run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R | ToolFailure> => {
      try {
        return await run(...args);
      } catch (error) {
        serverLog.warn("assistant.tool", {
          ...logFields,
          "plant.assistant.tool": name,
          "plant.outcome": "failed",
          "error.type": errorType(error),
        });
        onFailure();
        return { error: "read_failed" };
      }
    };

  return {
    getPortfolioSummary: tool({
      description:
        "Patrimonio neto de hoy: activos, deudas y lo que queda. Con una cartera, solo sus activos.",
      inputSchema: z.object({ portfolio }),
      execute: guarded("getPortfolioSummary", ({ portfolio }) =>
        data.portfolioSummary(portfolio),
      ),
    }),
    listHoldings: tool({
      description:
        "Las tenencias más grandes por valor, con su cuenta, su cartera y su parte del total.",
      inputSchema: z.object({ portfolio }),
      execute: guarded("listHoldings", ({ portfolio }) =>
        data.listHoldings(portfolio),
      ),
    }),
    getAllocation: tool({
      description:
        "Cómo están repartidos los activos: por tipo, por moneda y por cuenta.",
      inputSchema: z.object({ portfolio }),
      execute: guarded("getAllocation", ({ portfolio }) =>
        data.allocation(portfolio),
      ),
    }),
    getNetWorthHistory: tool({
      description:
        "El patrimonio neto al cierre de cada uno de los últimos 12 meses y el resultado de este año: lo que ganó, lo que puso y lo que cobró de dividendos, cupones y rentas.",
      inputSchema: z.object({}),
      execute: guarded("getNetWorthHistory", () => data.netWorthHistory()),
    }),
    convertCurrency: tool({
      description:
        "Convierte un monto entre pesos, dólar MEP y dólar CCL con las cotizaciones de hoy.",
      inputSchema: z.object({
        amount: z
          .string()
          .regex(/^\d{1,15}(\.\d{1,8})?$/)
          .describe(
            "El monto sin separador de miles y con punto decimal: 1500000.50, no 1.500.000,50",
          ),
        from: z.enum(CHAT_UNITS),
        to: z.enum(CHAT_UNITS),
      }),
      execute: guarded("convertCurrency", (input) =>
        data.convertCurrency(input),
      ),
    }),
    getIncomeEvents: tool({
      description:
        "Lo que el usuario espera cobrar en los próximos 90 días: dividendos y cupones según lo que pagó cada instrumento antes, y los plazos fijos que vencen, por fecha y sumado por mes.",
      inputSchema: z.object({}),
      execute: guarded("getIncomeEvents", () => data.incomeEvents()),
    }),
    getLiabilities: tool({
      description:
        "Las deudas del usuario con su saldo de hoy, su tasa nominal anual de hoy en porcentaje (annualRate), si acumula interés día a día (accrues), su cuota, sus cuotas restantes y su próximo vencimiento, y el total que debe. Una deuda saldada no aparece.",
      inputSchema: z.object({}),
      execute: guarded("getLiabilities", () => data.liabilities()),
    }),
    listTransactions: tool({
      description:
        "Los últimos movimientos (compras, ventas, dividendos, cupones, traspasos, ajustes), del más nuevo al más viejo, de un instrumento o de todos. Los montos están en la moneda de cada movimiento.",
      inputSchema: z.object({ instrument: instrument.optional() }),
      execute: guarded("listTransactions", ({ instrument }) =>
        data.transactions(instrument),
      ),
    }),
    getAssetInfo: tool({
      description:
        "Un instrumento: qué es, su precio de hoy, cuánto tiene el usuario y en qué cuentas y carteras.",
      inputSchema: z.object({ instrument }),
      execute: guarded("getAssetInfo", ({ instrument }) =>
        data.assetInfo(instrument),
      ),
    }),
    renderChart: tool({
      description:
        "Muestra un gráfico armado con los datos del usuario: net_worth (patrimonio neto al cierre de cada mes), allocation (cómo están repartidos los activos), holdings (las tenencias más grandes), income (lo que espera cobrar por mes) o debts (lo que debe). Devuelve los puntos del gráfico para comentarlo; el gráfico se muestra debajo de la respuesta.",
      inputSchema: z.object({
        kind: z.enum(CHART_TOPICS),
        portfolio: portfolio.describe(
          "Solo para allocation y holdings: el nombre o el id de una cartera; sin ella, todas.",
        ),
      }),
      execute: guarded("renderChart", ({ kind, portfolio }) =>
        data.chart(kind, portfolio),
      ),
    }),
    simulateScenario: tool({
      description:
        'Un escenario hipotético: cuánto valdría hoy el patrimonio neto si un dólar o un precio se moviera un porcentaje ("si el MEP sube 10 %", "si Apple cae 20 %"). Mueve solo lo indicado y deja igual el resto. Es un cálculo, no una predicción.',
      inputSchema: z
        .object({
          dollar: z
            .enum(SCENARIO_DOLLARS)
            .optional()
            .describe(
              "Qué dólar se mueve: mep, ccl, official o all (los tres). Sin él, all.",
            ),
          dollarChange: percent.optional(),
          instrument: instrument
            .optional()
            .describe(
              "El instrumento cuyo precio se mueve; sin él, todos los precios.",
            ),
          priceChange: percent.optional(),
        })
        .refine(pairedScenario, {
          message:
            "dollar va con dollarChange, instrument con priceChange, y hace falta al menos un cambio.",
        }),
      execute: guarded("simulateScenario", (input) => data.scenario(input)),
    }),
    getMonthSummary: tool({
      description:
        "El resumen de un mes cerrado, o de varios seguidos: cómo empezó y terminó el patrimonio neto, de dónde sale el cambio (lo que puso o sacó, los precios, el dólar, los rendimientos y los intereses de sus deudas), el resultado, lo que cobró, los gastos y cómo le fue contra la inflación y el dólar. Muestra un gráfico de cascada. Sin meses, el último mes cerrado.",
      inputSchema: z.object({
        from: month.optional().describe("El primer mes: 2026-06."),
        to: month
          .optional()
          .describe("El último mes; sin él, solo el primero."),
      }),
      execute: guarded("getMonthSummary", (input) => data.monthSummary(input)),
    }),
    getImportStatus: tool({
      description:
        "Los últimos archivos que el usuario subió en Cargar, en qué estado está cada uno y cuántas cargas usó este mes.",
      inputSchema: z.object({}),
      execute: guarded("getImportStatus", () => data.importStatus()),
    }),
  };
}
