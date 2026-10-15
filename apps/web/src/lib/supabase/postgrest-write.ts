import type {
  PostgrestError,
  PostgrestSingleResponse,
} from "@supabase/supabase-js";

export const ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST\d+)$/;

// `code` is `timeout`, `fetch_error`, a SQLSTATE or PostgREST code, or
// `http_<status>`: never the error's details or hint, which carry the failing
// row. `mayHaveCommitted` is true after a timeout, a failed connection or a
// 5xx, when the write may have committed before the answer was lost; any other
// failure wrote nothing.
export type PostgrestFailure = { code: string; mayHaveCommitted: boolean };

// postgrest-js reports some answers as success (a 404 with an empty body
// becomes a 204), and the error of a failed one can be falsy, so only the
// status decides. An update that matched no row (filtered by RLS or a wrong
// id) passes too; select the row to tell.
export function classifyPostgrestResult(
  { error, status }: { error: PostgrestError | null; status: number },
  expected: number | readonly number[],
): PostgrestFailure | null {
  if (
    typeof expected === "number"
      ? status === expected
      : expected.includes(status)
  ) {
    return null;
  }
  if (status === 0) return { code: "fetch_error", mayHaveCommitted: true };
  const code = typeof error?.code === "string" ? error.code : "";
  return {
    code: ERROR_CODE.test(code) ? code : `http_${status}`,
    mayHaveCommitted: status >= 500,
  };
}

// A guard's hint, read only against the guards' known lists for their
// SQLSTATE, since an unknown hint could carry any text.
export function knownHint<
  G extends { sqlstate: string; hints: readonly string[] },
>(
  guards: readonly G[],
  { code }: Pick<PostgrestFailure, "code">,
  hint: unknown,
): G["hints"][number] | undefined {
  for (const guard of guards) {
    if (code !== guard.sqlstate) continue;
    const known = guard.hints.find((each) => each === hint);
    if (known !== undefined) return known;
  }
  return undefined;
}

// A query raced against a timer: it resolves with the answer when its status
// is one of `expected`, else as a PostgrestFailure (a timeout too); a query
// that rejects or throws still rejects. `count` is the total PostgREST counted
// when the query asked for one.
export async function postgrestCall<T>(
  query: (signal: AbortSignal) => PromiseLike<PostgrestSingleResponse<T>>,
  ms: number,
  expected: readonly number[],
): Promise<{ data: T | null; count: number | null } | PostgrestFailure> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PostgrestFailure>((resolve) => {
    // Settles even when the fetch ignores the abort.
    timer = setTimeout(() => {
      controller.abort();
      resolve({ code: "timeout", mayHaveCommitted: true });
    }, ms);
  });
  try {
    const result = await Promise.race([query(controller.signal), timeout]);
    if (!("status" in result)) return result;
    return (
      classifyPostgrestResult(result, expected) ?? {
        data: result.data,
        count: result.count,
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

// PostgREST answers an insert with 201; data is null when the insert returns
// no representation or postgrest-js could not parse its body. Not for
// `.maybeSingle()`: postgrest-js turns its 2xx with several rows into a 406
// after the write committed.
export async function postgrestInsert<T>(
  query: (signal: AbortSignal) => PromiseLike<PostgrestSingleResponse<T>>,
  ms: number,
): Promise<{ data: T | null } | PostgrestFailure> {
  const result = await postgrestCall(query, ms, [201]);
  return "code" in result ? result : { data: result.data };
}
