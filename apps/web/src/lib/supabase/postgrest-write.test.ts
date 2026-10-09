import type { PostgrestError } from "@supabase/supabase-js";

import { classifyPostgrestResult, postgrestInsert } from "./postgrest-write";

const pgError = (code: unknown): PostgrestError =>
  ({
    code,
    message: "m",
    details: "Failing row contains (… 0.0087 …).",
    hint: "h",
  }) as unknown as PostgrestError;

describe("classifyPostgrestResult", () => {
  it("passes the expected status", () => {
    expect(classifyPostgrestResult({ error: null, status: 201 }, 201)).toBe(
      null,
    );
    expect(classifyPostgrestResult({ error: null, status: 204 }, 204)).toBe(
      null,
    );
    expect(classifyPostgrestResult({ error: null, status: 201 }, 204)).toEqual({
      code: "http_201",
      mayHaveCommitted: false,
    });
  });

  it.each([
    ["a failed connection", null, 0, "fetch_error", true],
    ["a SQLSTATE", pgError("23514"), 400, "23514", false],
    ["a PostgREST code", pgError("PGRST204"), 400, "PGRST204", false],
    ["a 5xx with a SQLSTATE", pgError("57014"), 500, "57014", true],
    ["a code that is not one", pgError("not a code"), 409, "http_409", false],
    ["a non-string code", pgError(23514), 400, "http_400", false],
    ["a 4-character code", pgError("2351"), 400, "http_400", false],
    ["a 6-character code", pgError("235140"), 400, "http_400", false],
    ["a PGRST code with letters", pgError("PGRST20x"), 400, "http_400", false],
    ["a lowercase word", pgError("abcde"), 400, "http_400", false],
    ["no error", null, 204, "http_204", false],
    ["a 503 with no error", null, 503, "http_503", true],
  ])("classifies %s", (_label, error, status, code, mayHaveCommitted) => {
    expect(classifyPostgrestResult({ error, status }, 201)).toEqual({
      code,
      mayHaveCommitted,
    });
  });
});

describe("postgrestInsert", () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    const pending = jest.getTimerCount();
    jest.useRealTimers();
    expect(pending).toBe(0);
  });

  const answer = (status: number, error: PostgrestError | null = null) =>
    ({
      data: status === 201 ? { id: 1 } : null,
      error,
      count: null,
      status,
      statusText: "",
    }) as never;

  it("returns the data of a 201", async () => {
    await expect(
      postgrestInsert(async () => answer(201), 1000),
    ).resolves.toEqual({ data: { id: 1 } });
  });

  it("returns the classified failure of any other answer", async () => {
    await expect(
      postgrestInsert(async () => answer(400, pgError("23505")), 1000),
    ).resolves.toEqual({ code: "23505", mayHaveCommitted: false });
  });

  it("clears the deadline when the query rejects", async () => {
    await expect(
      postgrestInsert(async () => {
        throw new Error("boom");
      }, 1000),
    ).rejects.toThrow("boom");
  });

  it("clears the deadline when the query throws", async () => {
    await expect(
      postgrestInsert(() => {
        throw new Error("boom");
      }, 1000),
    ).rejects.toThrow("boom");
  });

  it("aborts the query and returns a timeout when it outlasts the deadline", async () => {
    let signal: AbortSignal | undefined;
    const result = postgrestInsert((s) => {
      signal = s;
      return new Promise<never>(() => {});
    }, 1500);
    jest.advanceTimersByTime(1499);
    expect(signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(result).resolves.toEqual({
      code: "timeout",
      mayHaveCommitted: true,
    });
    expect(signal?.aborted).toBe(true);
  });
});
