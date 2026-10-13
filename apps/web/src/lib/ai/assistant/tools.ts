import "server-only";
import { tool } from "ai";
import { z } from "zod";

import { CHAT_UNITS } from "@/lib/assistant/chat";
import type { AssistantData, ToolFailure } from "@/lib/assistant/tools-data";
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
        "Las deudas del usuario con su saldo, su cuota, sus cuotas restantes y su próximo vencimiento, y el total que debe.",
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
    getImportStatus: tool({
      description:
        "Los últimos archivos que el usuario subió en Cargar, en qué estado está cada uno y cuántas cargas usó este mes.",
      inputSchema: z.object({}),
      execute: guarded("getImportStatus", () => data.importStatus()),
    }),
  };
}
