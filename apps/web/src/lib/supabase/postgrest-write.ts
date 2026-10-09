import type {
  PostgrestError,
  PostgrestSingleResponse,
} from "@supabase/supabase-js";

const ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST\d+)$/;

// `code` is `timeout`, `fetch_error`, a SQLSTATE or PostgREST code, or
// `http_<status>`: never the error's details or hint, which carry the failing
// row. `mayHaveCommitted` is true after a timeout, a failed connection or a
// 5xx, when the write may have committed before the answer was lost; any other
// failure wrote nothing.
export type PostgrestFailure = { code: string; mayHaveCommitted: boolean };

// postgrest-js reports some answers as success (a 404 with an empty body
// becomes a 204), and the error of a failed one can be falsy, so only the
// status decides.
export function classifyPostgrestResult(
  { error, status }: { error: PostgrestError | null; status: number },
  expectedStatus: number,
): PostgrestFailure | null {
  if (status === expectedStatus) return null;
  if (status === 0) return { code: "fetch_error", mayHaveCommitted: true };
  const code = typeof error?.code === "string" ? error.code : "";
  return {
    code: ERROR_CODE.test(code) ? code : `http_${status}`,
    mayHaveCommitted: status >= 500,
  };
}

// PostgREST answers an insert with 201; data is null when postgrest-js could
// not parse its body. A timeout or any other answer resolves as a
// PostgrestFailure; a query that rejects or throws still rejects.
export async function postgrestInsert<T>(
  query: (signal: AbortSignal) => PromiseLike<PostgrestSingleResponse<T>>,
  ms: number,
): Promise<{ data: T | null } | PostgrestFailure> {
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
    return classifyPostgrestResult(result, 201) ?? { data: result.data };
  } finally {
    clearTimeout(timer);
  }
}
