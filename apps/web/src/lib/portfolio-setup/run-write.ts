import "server-only";
import type { Database } from "@plant/shared";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { z } from "zod";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import {
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from "@/lib/request-id";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";
import { PortfolioSetupError } from "./errors";
import { idSchema } from "./schemas";
import {
  toWriteResult,
  type WriteResult,
  type WriteResultCode,
} from "./write-result";

export type PortfolioSetupAction =
  | "create_portfolio"
  | "rename_portfolio"
  | "archive_portfolio"
  | "restore_portfolio"
  | "restore_rename_portfolio";

type Client = SupabaseClient<Database>;

// A write with `.select("id")`, so the rows it touched come back.
type WriteResponse = PromiseLike<{
  data: { id: string }[] | null;
  error: PostgrestError | null;
  status: number;
}>;

export type UpdateArgs<I> = {
  client: Client;
  userId: string;
  input: I;
  id: string;
};

type Spec<I> = {
  action: PortfolioSetupAction;
  schema: z.ZodType<I>;
  input: unknown;
};

const PAGE = "/accounts";

// The target of an insert, which has no id to parse.
const INSERT = Symbol("insert");

function log(
  action: PortfolioSetupAction,
  fields: {
    outcome: WriteResultCode | "ok";
    requestId: string | undefined;
    userId: string;
    rowId: string | undefined;
    started: number;
  },
  error?: PortfolioSetupError,
): void {
  const line = {
    [REQUEST_ID_FIELD]: fields.requestId,
    "enduser.id": fields.userId,
    "plant.portfolio_setup.action": action,
    "plant.portfolio_setup.row_id": fields.rowId,
    "plant.portfolio_setup.duration_ms": Math.round(
      performance.now() - fields.started,
    ),
  };
  const event = "portfolio_setup.write";
  switch (fields.outcome) {
    case "failed":
      serverLog.error(event, { ...line, "plant.outcome": "error" }, error);
      return;
    case "not_found":
    case "invalid":
      serverLog.warn(event, { ...line, "plant.outcome": fields.outcome });
      return;
    default:
      serverLog.info(event, { ...line, "plant.outcome": fields.outcome });
  }
}

// claims → parse → write as the user (RLS) → classify → one log line →
// revalidate the page. An insert must answer 201 with its row; an update must answer 200 with exactly one row, and none means the
// id is not one of the user's.
async function run<I>(
  { action, schema, input }: Spec<I>,
  target: typeof INSERT | { id: unknown },
  write: (args: {
    client: Client;
    userId: string;
    input: I;
    id: string | undefined;
  }) => WriteResponse,
): Promise<WriteResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = requestIdFrom((await headers()).get(REQUEST_ID_HEADER));
  const userId = claims.sub;
  const isInsert = target === INSERT;
  const id = isInsert ? undefined : idSchema.safeParse(target.id);
  const parsed = schema.safeParse(input);
  const filterId = id?.success ? id.data : undefined;

  let result: WriteResult;
  let error: PortfolioSetupError | undefined;
  if (!parsed.success || (id && !id.success)) {
    result = { ok: false, code: "invalid" };
  } else {
    const client: Client = await createClient();
    const response = await write({
      client,
      userId,
      input: parsed.data,
      id: filterId,
    });
    const failure = classifyPostgrestResult(response, isInsert ? 201 : 200);
    const rows = response.data ?? [];
    if (failure) {
      const code = toWriteResult(failure, response.error?.hint);
      result = { ok: false, code };
      if (code === "failed") error = new PortfolioSetupError(failure.code);
    } else if (rows.length === 1) {
      result = { ok: true, id: rows[0]!.id };
    } else if (rows.length === 0 && !isInsert) {
      result = { ok: false, code: "not_found" };
    } else {
      result = { ok: false, code: "failed" };
      error = new PortfolioSetupError(`rows_${rows.length}`);
    }
  }

  log(
    action,
    {
      outcome: result.ok ? "ok" : result.code,
      requestId,
      userId,
      rowId: result.ok ? result.id : filterId,
      started,
    },
    error,
  );
  revalidatePath(PAGE);
  return result;
}

export function runInsert<I>(
  spec: Spec<I>,
  write: (args: { client: Client; userId: string; input: I }) => WriteResponse,
): Promise<WriteResult> {
  return run(spec, INSERT, write);
}

export function runUpdate<I>(
  spec: Spec<I>,
  id: unknown,
  write: (args: UpdateArgs<I>) => WriteResponse,
): Promise<WriteResult> {
  return run(spec, { id }, ({ id: parsedId, ...rest }) =>
    write({ ...rest, id: parsedId! }),
  );
}
