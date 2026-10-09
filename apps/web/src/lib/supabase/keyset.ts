import { z } from "zod";

// A position in a list ordered by (timestamp desc, id desc). The timestamp
// stays the text PostgREST returned: a Date would drop its microseconds and
// the next page would repeat or skip rows.
export type Keyset = { at: string; id: string };

const keysetSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

// A missing param is the first page; anything that is not one timestamp and
// one uuid is invalid, so no caller-supplied text reaches a filter.
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

// The href of the next page of one list, keeping the other lists' params.
export function keysetHref(
  params: KeysetParams,
  key: string,
  { at, id }: Keyset,
) {
  const search = otherParams(params, key);
  search.set(key, `${at},${id}`);
  return `?${search.toString()}`;
}

// The href of one list's first page, keeping the other lists' params.
export function firstPageHref(params: KeysetParams, key: string): string {
  return `?${otherParams(params, key).toString()}`;
}
