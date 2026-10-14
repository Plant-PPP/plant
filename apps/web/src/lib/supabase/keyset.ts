import { z } from "zod";

// A position in a list ordered by (timestamp desc, id desc). The timestamp
// stays the text PostgREST returned: a Date would drop its microseconds and
// the next page would repeat or skip rows.
export type Keyset = { at: string; id: string };

// Postgres refuses the year 0, an offset beyond ±15:59 and a long enough
// fraction, which ISO allows. PostgREST writes at most microseconds.
const timestampSchema = z.iso
  .datetime({ offset: true })
  .refine(
    (at) =>
      !at.startsWith("0000") &&
      !/[+-](1[6-9]|2\d):\d{2}$/.test(at) &&
      !/\.\d{7}/.test(at),
  );

const keysetSchema = z.tuple([timestampSchema, z.uuid()]);

// A missing param is the first page; anything that is not one timestamp
// Postgres reads and one uuid is invalid, so no caller-supplied text reaches a
// filter and no cursor makes the read fail.
export function parseKeyset(
  raw: string | string[] | undefined,
): { ok: true; cursor: Keyset | null } | { ok: false } {
  if (raw === undefined) return { ok: true, cursor: null };
  if (typeof raw !== "string") return { ok: false };
  const parsed = keysetSchema.safeParse(raw.split(","));
  if (!parsed.success) return { ok: false };
  const [at, id] = parsed.data;
  return { ok: true, cursor: { at, id } };
}

// The rows after the cursor, for `.or()`. Callers also bound the column with
// `.lte(column, cursor.at)`, which PostgREST can use as an index condition.
export function keysetFilter(column: string, { at, id }: Keyset): string {
  return `${column}.lt."${at}",and(${column}.eq."${at}",id.lt.${id})`;
}

// Every row of a list ordered by (timestamp desc, id desc), each page read
// after the last row of the one before, so a write committed between two
// pages cannot repeat or skip a row the way an offset would. `page` reads up
// to `pageSize` rows after the cursor, or from the start when it is null.
// Past `limit` rows the read stops and says it was cut.
export async function readAllByKeyset<T>(
  page: (after: Keyset | null) => PromiseLike<T[]>,
  keyOf: (row: T) => Keyset,
  { pageSize, limit }: { pageSize: number; limit: number },
): Promise<{ rows: T[]; cut: boolean }> {
  const rows: T[] = [];
  let after: Keyset | null = null;
  for (;;) {
    const data = await page(after);
    rows.push(...data);
    if (rows.length > limit) return { rows: rows.slice(0, limit), cut: true };
    if (data.length < pageSize) return { rows, cut: false };
    after = keyOf(data.at(-1)!);
  }
}

// A page's search params.
export type KeysetParams = Record<string, string | string[] | undefined>;

function otherParams(params: KeysetParams, key: string): URLSearchParams {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === key || value === undefined) continue;
    for (const item of [value].flat()) search.append(name, item);
  }
  return search;
}

// The href that sets one param, or drops it when null, keeping the others.
export function paramHref(
  params: KeysetParams,
  key: string,
  value: string | null,
): string {
  const search = otherParams(params, key);
  if (value !== null) search.set(key, value);
  return `?${search.toString()}`;
}

// The href of the next page of one list, keeping the other lists' params.
export function keysetHref(
  params: KeysetParams,
  key: string,
  { at, id }: Keyset,
) {
  return paramHref(params, key, `${at},${id}`);
}

// The href of one list's first page, keeping the other lists' params.
export function firstPageHref(params: KeysetParams, key: string): string {
  return paramHref(params, key, null);
}
