import { type Currency, decimalStringSchema } from "@plant/shared";

import type { AccountMovementRow } from "./draft";

// IOL's "Movimientos históricos" export: an HTML table saved as .xls, one row
// per account side of each movement. A trade in dollars settles its units and
// commission in the dollar account and its market fee in the peso one, both
// rows under the same order number.

// The most rows one export may hold, and the most bytes read.
export const IOL_MOVEMENTS_ROW_LIMIT = 5000;
export const IOL_MOVEMENTS_BYTE_LIMIT = 5 * 1024 * 1024;

export type IolMovementKind = AccountMovementRow["kind"];

// One account side of a movement as IOL prints it: the symbol between
// parentheses (a CEDEAR's dollar line keeps its D, a dividend's dollar side
// its " US$" dropped), and the order number its sides share.
export type IolMovementRow = AccountMovementRow;

// The rows read and how many were skipped, or why the file is not an export
// Plant can read: not IOL's table, or past the limits.
export type IolMovements =
  | { ok: true; rows: IolMovementRow[]; skipped: number }
  | { ok: false; code: "unsupported" | "too_large" };

const HEADERS = [
  "nro. de mov.",
  "nro. de boleto",
  "tipo mov.",
  "concert.",
  "liquid.",
  "est",
  "cant. titulos",
  "precio",
  "comis.",
  "iva com.",
  "otros imp.",
  "monto",
  "observaciones",
  "tipo cuenta",
] as const;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decoded = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[body.toLowerCase()] ?? entity;
  });

const cellText = (html: string) =>
  decoded(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// An es-AR number: thousands dots and a decimal comma.
function decimalOf(text: string): string | null {
  if (!/^-?[\d.]+(,\d+)?$/.test(text)) return null;
  const value = text.replace(/\./g, "").replace(",", ".");
  return decimalStringSchema.safeParse(value).success ? value : null;
}

// dd/mm/yy, in this century.
function dateOf(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `20${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
}

function currencyOf(account: string): Currency | null {
  const name = plain(account);
  if (name.endsWith("dolares")) return "USD";
  if (name.endsWith("pesos")) return "ARS";
  return null;
}

const SYMBOL = /\(([A-Za-z0-9.]{1,30})(?: US\$)?\)/;

function kindOf(
  description: string,
): { kind: IolMovementKind; symbol: string | null } | null {
  const name = plain(description);
  const symbol = SYMBOL.exec(description)?.[1]?.toUpperCase() ?? null;
  if (name.startsWith("compra("))
    return symbol ? { kind: "purchase", symbol } : null;
  if (name.startsWith("venta("))
    return symbol ? { kind: "sale", symbol } : null;
  if (name.startsWith("pago de dividendos(")) {
    return symbol ? { kind: "dividend", symbol } : null;
  }
  if (name.startsWith("deposito de fondos")) {
    return { kind: "deposit", symbol: null };
  }
  if (name.startsWith("extraccion de fondos")) {
    return { kind: "withdrawal", symbol: null };
  }
  if (name === "credito") return { kind: "credit", symbol: null };
  return null;
}

// Reads the export. A finished row Plant cannot read, or one not finished, is
// counted as skipped.
export function readIolMovements(html: string): IolMovements {
  if (html.length > IOL_MOVEMENTS_BYTE_LIMIT) {
    return { ok: false, code: "too_large" };
  }
  const table = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) return { ok: false, code: "unsupported" };
  const lines = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((line) =>
    [...line[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
      cellText(cell[1]!),
    ),
  );
  const [header, ...body] = lines;
  if (
    !header ||
    header.length !== HEADERS.length ||
    header.some((name, index) => plain(name) !== HEADERS[index])
  ) {
    return { ok: false, code: "unsupported" };
  }
  if (body.length > IOL_MOVEMENTS_ROW_LIMIT) {
    return { ok: false, code: "too_large" };
  }
  const rows: IolMovementRow[] = [];
  let skipped = 0;
  for (const cells of body) {
    const [
      number,
      ,
      description,
      traded,
      ,
      state,
      units,
      price,
      commission,
      vat,
      otherTaxes,
      amount,
      ,
      account,
    ] = cells;
    const kind = kindOf(description ?? "");
    const row = {
      number: /^\d{1,40}$/.test(number ?? "") ? number! : null,
      date: dateOf(traded ?? ""),
      quantity: decimalOf(units ?? ""),
      price: decimalOf(price ?? ""),
      commission: decimalOf(commission ?? ""),
      vat: decimalOf(vat ?? ""),
      otherTaxes: decimalOf(otherTaxes ?? ""),
      amount: decimalOf(amount ?? ""),
      currency: currencyOf(account ?? ""),
    };
    if (
      cells.length !== HEADERS.length ||
      plain(state ?? "") !== "terminada" ||
      !kind ||
      row.number === null ||
      row.date === null ||
      row.quantity === null ||
      row.price === null ||
      row.commission === null ||
      row.vat === null ||
      row.otherTaxes === null ||
      row.amount === null ||
      row.currency === null
    ) {
      skipped += 1;
      continue;
    }
    const trade = kind.kind === "purchase" || kind.kind === "sale";
    rows.push({
      number: row.number,
      kind: kind.kind,
      symbol: kind.symbol,
      date: row.date,
      quantity: trade ? row.quantity : null,
      price: trade ? row.price : null,
      commission: row.commission,
      vat: row.vat,
      otherTaxes: row.otherTaxes,
      amount: row.amount,
      currency: row.currency,
    });
  }
  return { ok: true, rows, skipped };
}
