import { z } from "zod";

import type { DraftOperation, DraftRow } from "../file-upload/draft";
import {
  call,
  cashRow,
  decimalOf,
  holdingsReading,
  isZero,
  jsonOf,
  operationsReading,
  positive,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection, type ReadPeriod } from "./port";

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

// An order as IOL lists it. Only what Plant reads is named, every field but
// its number optional: what IOL executed (`…Operado`, `fechaOperada`) wins
// over what was ordered.
const orderSchema = z.object({
  numero: z.union([z.number(), z.string()]),
  tipo: z.string().optional(),
  estado: z.string().optional(),
  mercado: z.string().optional(),
  simbolo: z.string().optional(),
  moneda: z.string().optional(),
  fechaOrden: z.string().nullish(),
  fechaOperada: z.string().nullish(),
  cantidad: z.unknown().optional(),
  cantidadOperada: z.unknown().optional(),
  precio: z.unknown().optional(),
  precioOperado: z.unknown().optional(),
  monto: z.unknown().optional(),
  montoOperado: z.unknown().optional(),
});
const ordersSchema = z.array(orderSchema);

// IOL names an order's kind in Spanish words; only trades are operations.
const KINDS: Record<string, DraftOperation["kind"]> = {
  compra: "purchase",
  venta: "sale",
};

const plain = (text: string | undefined) =>
  (text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

// The market an order's currency follows when IOL does not name it.
const MARKET_CURRENCY: Record<string, "ARS" | "USD"> = {
  bcba: "ARS",
  nyse: "USD",
  nasdaq: "USD",
  amex: "USD",
};

const DAY = /^\d{4}-\d{2}-\d{2}/;

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

  // The account's executed buys and sells in the period, which IOL filters by
  // state and day itself; any other kind of order is skipped.
  const operations = async (bearer: string, { from, to }: ReadPeriod) => {
    const query = new URLSearchParams({ "filtro.estado": "terminadas" });
    if (from) query.set("filtro.fechaDesde", from);
    if (to) query.set("filtro.fechaHasta", to);
    const orders = ordersSchema.safeParse(
      await read(`/api/v2/operaciones?${query}`, bearer),
    );
    if (!orders.success) throw unavailable();
    const found: DraftOperation[] = [];
    let skipped = 0;
    for (const order of orders.data) {
      const kind = KINDS[plain(order.tipo)];
      const symbol = (order.simbolo ?? "").trim();
      const date = (order.fechaOperada ?? order.fechaOrden ?? "").match(
        DAY,
      )?.[0];
      const currency =
        currencyOf(order.moneda) ?? MARKET_CURRENCY[plain(order.mercado)];
      const quantity = decimalOf(order.cantidadOperada ?? order.cantidad);
      const price = decimalOf(order.precioOperado ?? order.precio);
      const amount = decimalOf(order.montoOperado ?? order.monto);
      if (!kind || !SYMBOL.test(symbol) || !date || !currency) {
        skipped += 1;
        continue;
      }
      found.push({
        date,
        kind,
        symbol,
        quantity: positive(quantity) ? quantity : null,
        price: positive(price) ? price : null,
        amount: positive(amount) ? amount : null,
        charges: null,
        reference: String(order.numero).trim().slice(0, 40) || null,
        currency,
        // The order fields come from IOL's documentation, not from a live
        // account: the review asks the user to look.
        confidence: "medium",
        page: null,
      });
    }
    return operationsReading(found, skipped);
  };

  return defineConnection({
    provider: "iol",
    credentials: iolCredentialsSchema,
    secrets: ["password"],
    hintField: "username",
    readOnly: "none",
    drafts: ["holdings", "operations"],
    check: async (credentials) => {
      await token(credentials);
    },
    async read(credentials, draft, period) {
      const bearer = await token(credentials);
      if (draft === "operations") return operations(bearer, period);
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
      // Each account's cash in its currency.
      for (const { moneda, saldo } of state.data.cuentas) {
        const currency = currencyOf(moneda);
        const quantity = decimalOf(saldo);
        if (isZero(quantity)) continue;
        if (currency === null || !positive(quantity)) {
          skipped += 1;
          continue;
        }
        rows.push(cashRow(currency, quantity, "medium"));
      }
      return holdingsReading(rows, skipped, now());
    },
  });
}
