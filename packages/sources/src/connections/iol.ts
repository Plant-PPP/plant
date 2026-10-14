import type { Currency } from "@plant/shared";
import { z } from "zod";

import type { DraftRow } from "../file-upload/draft";
import {
  call,
  summedCashRows,
  decimalOf,
  holdingsReading,
  isZero,
  jsonOf,
  positive,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";

export const IOL_BASE_URL = "https://api.invertironline.com";

export const iolCredentialsSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
type IolCredentials = z.infer<typeof iolCredentialsSchema>;

const tokenSchema = z.object({ access_token: z.string().min(1) });

const portfolioSchema = z.object({
  activos: z.array(
    z.object({
      cantidad: z.unknown(),
      ultimoPrecio: z.unknown().optional(),
      ppc: z.unknown().optional(),
      valorizado: z.unknown().optional(),
      titulo: z.object({ simbolo: z.string(), moneda: z.string().optional() }),
    }),
  ),
});

const accountStateSchema = z.object({
  cuentas: z.array(z.object({ moneda: z.string(), saldo: z.unknown() })),
});

// IOL names a currency in words.
const currencyOf = (moneda: string | undefined): "ARS" | "USD" | null =>
  moneda === "peso_Argentino"
    ? "ARS"
    : moneda === "dolar_Estadounidense"
      ? "USD"
      : null;

const SYMBOL = /^[A-Za-z0-9.]{1,30}$/;

// InvertirOnline by its API, with the user's own username and password: IOL
// has no read-only credential, so Plant's code is what keeps it to reading.
// It asks for a token (the only POST) and then calls only GETs: the
// portfolio in Argentina and the cash of each account. A fresh token per
// read, so no refresh token is kept.
export function iolConnection({
  baseUrl = IOL_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 15_000,
}: ConnectionDeps = {}) {
  const token = async ({ username, password }: IolCredentials) => {
    const response = await call(
      get,
      `${baseUrl}/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username,
          password,
          grant_type: "password",
        }).toString(),
      },
      timeoutMs,
    );
    const body = await jsonOf(response);
    if (response.status === 400 || response.status === 401) throw rejected();
    const parsed = tokenSchema.safeParse(body);
    if (!response.ok || !parsed.success) throw unavailable();
    return parsed.data.access_token;
  };

  const read = async (path: string, bearer: string): Promise<unknown> => {
    const response = await call(
      get,
      `${baseUrl}${path}`,
      {
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
    const body = await jsonOf(response);
    if (response.ok) return body;
    if (response.status === 401 || response.status === 403) throw rejected();
    throw unavailable();
  };

  return defineConnection({
    provider: "iol",
    credentials: iolCredentialsSchema,
    secrets: ["password"],
    hintField: "username",
    readOnly: "none",
    drafts: ["holdings"],
    check: async (credentials) => {
      await token(credentials);
    },
    async read(credentials) {
      const bearer = await token(credentials);
      const portfolio = portfolioSchema.safeParse(
        await read("/api/v2/portafolio/argentina", bearer),
      );
      const state = accountStateSchema.safeParse(
        await read("/api/v2/estadocuenta", bearer),
      );
      if (!portfolio.success || !state.success) throw unavailable();
      const rows: DraftRow[] = [];
      let skipped = 0;
      for (const each of portfolio.data.activos) {
        const symbol = each.titulo.simbolo.trim();
        const quantity = decimalOf(each.cantidad);
        const currency = currencyOf(each.titulo.moneda);
        if (quantity !== null && !positive(quantity)) continue;
        if (!SYMBOL.test(symbol) || quantity === null || currency === null) {
          skipped += 1;
          continue;
        }
        const price = decimalOf(each.ultimoPrecio);
        const value = decimalOf(each.valorizado);
        const cost = decimalOf(each.ppc);
        rows.push({
          symbol,
          quantity,
          price: positive(price) ? price : null,
          value: positive(value) ? value : null,
          ...(positive(cost) && { cost }),
          currency,
          confidence: "high",
          page: null,
        });
      }
      // The cash of every account in a currency, added up.
      const cash: { currency: Currency; amount: string }[] = [];
      for (const { moneda, saldo } of state.data.cuentas) {
        const currency = currencyOf(moneda);
        const amount = decimalOf(saldo);
        if (isZero(amount)) continue;
        if (currency === null || amount === null) {
          skipped += 1;
          continue;
        }
        cash.push({ currency, amount });
      }
      const summed = summedCashRows(cash, "medium");
      rows.push(...summed.rows);
      return holdingsReading(rows, skipped + summed.skipped, now());
    },
  });
}
