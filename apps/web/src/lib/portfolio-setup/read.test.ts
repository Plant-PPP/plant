jest.mock("server-only", () => ({}), { virtual: true });

import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureServerLog } from "@/lib/log/capture-server-log";
import { isLoggedError } from "@/lib/log/logged-error";
import { ARCHIVED_ROW_LIMIT, PAGE_ROW_LIMIT } from "./limits";
import { readHolders, readPortfolios, readSourceConnections } from "./read";

const USER = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
const AT = "2026-10-09T14:18:15.123456+00:00";
const ID = "22222222-2222-4222-8222-222222222222";
const SENTINEL = "Cartera secreta";

type Row = Record<string, unknown> & { id: string };
type Response = { data: Row[] | null; error: unknown; status: number };

// Two queries, active first: each records its calls and answers when awaited.
function fakeClient(active: Response, archived: Response) {
  const calls: unknown[][][] = [];
  const responses = [active, archived];
  const client = {
    from: () => {
      const own: unknown[][] = [];
      calls.push(own);
      const response = responses.shift();
      const builder: Record<string, unknown> = {
        then: (resolve: (value: Response) => unknown) => resolve(response!),
      };
      for (const method of [
        "select",
        "eq",
        "is",
        "not",
        "lte",
        "or",
        "order",
        "limit",
      ]) {
        builder[method] = (...args: unknown[]) => {
          own.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

const rows = (count: number, archived = false): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Cartera ${i}`,
    ...(archived ? { archived_at: AT } : {}),
  }));

const ok = (data: Row[]): Response => ({ data, error: null, status: 200 });

let lines: Record<string, unknown>[];

beforeEach(() => {
  lines = captureServerLog();
});

afterEach(() => jest.restoreAllMocks());

const read = (client: SupabaseClient<Database>, params = {}) =>
  readPortfolios(client, { userId: USER, requestId: REQUEST_ID, params });

it("reads both lists by the user, newest first", async () => {
  const { client, calls } = fakeClient(ok(rows(2)), ok(rows(1, true)));
  const view = await read(client);
  expect(view).toEqual({
    active: rows(2).map(({ id, name }) => ({ id, name })),
    activeTruncated: false,
    archived: rows(1).map(({ id, name }) => ({ id, name })),
    archivedPage: null,
    archivedFirstHref: null,
    archivedNextHref: null,
  });
  expect(calls[0]).toEqual([
    ["select", "id, name"],
    ["eq", "user_id", USER],
    ["is", "archived_at", null],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
    ["limit", PAGE_ROW_LIMIT + 1],
  ]);
  expect(calls[1]).toEqual([
    ["select", "id, name, archived_at"],
    ["eq", "user_id", USER],
    ["not", "archived_at", "is", null],
    ["order", "archived_at", { ascending: false }],
    ["order", "id", { ascending: false }],
    ["limit", ARCHIVED_ROW_LIMIT + 1],
  ]);
  expect(lines).toHaveLength(0);
});

it("says when active rows were left out", async () => {
  const { client } = fakeClient(ok(rows(PAGE_ROW_LIMIT + 1)), ok([]));
  const view = await read(client);
  expect(view.active).toHaveLength(PAGE_ROW_LIMIT);
  expect(view.activeTruncated).toBe(true);
});

it("links the next page of archived rows from the last one shown", async () => {
  const archived = rows(ARCHIVED_ROW_LIMIT + 1, true);
  const { client } = fakeClient(ok([]), ok(archived));
  const view = await read(client, { titulares: "x" });
  expect(view.archived).toHaveLength(ARCHIVED_ROW_LIMIT);
  const last = archived[ARCHIVED_ROW_LIMIT - 1]!;
  const next = new URLSearchParams(view.archivedNextHref!.slice(1));
  expect(next.get("carteras")).toBe(`${AT},${last.id}`);
  expect(next.get("titulares")).toBe("x");
});

it("links no next page when exactly a page of archived rows is left", async () => {
  const { client } = fakeClient(ok([]), ok(rows(ARCHIVED_ROW_LIMIT, true)));
  const view = await read(client);
  expect(view.archived).toHaveLength(ARCHIVED_ROW_LIMIT);
  expect(view.archivedNextHref).toBeNull();
});

it("reads archived rows after a cursor, bounded by its timestamp", async () => {
  const { client, calls } = fakeClient(ok([]), ok([]));
  const view = await read(client, { carteras: `${AT},${ID}` });
  expect(calls[1]).toContainEqual(["lte", "archived_at", AT]);
  expect(calls[1]).toContainEqual([
    "or",
    `archived_at.lt."${AT}",and(archived_at.eq."${AT}",id.lt.${ID})`,
  ]);
  expect(view.archivedFirstHref).toBe("?");
  expect(view.archivedPage).toBe(`${AT},${ID}`);
});

it("shows the first page and warns on an invalid cursor", async () => {
  const { client, calls } = fakeClient(ok([]), ok([]));
  const view = await read(client, {
    carteras: `x),user_id.not.is.null,and(id.lt.${ID}`,
  });
  expect(calls[1]!.map(([method]) => method)).not.toContain("or");
  expect(view.archivedPage).toBeNull();
  expect(view.archivedFirstHref).toBeNull();
  expect(lines).toEqual([
    expect.objectContaining({
      level: "warn",
      event: "portfolio_setup.read",
      "enduser.id": USER,
      "plant.request_id": REQUEST_ID,
      "plant.portfolio_setup.table": "portfolios",
      "plant.outcome": "invalid_cursor",
    }),
  ]);
});

it("logs a failed read by its code and throws an error already logged", async () => {
  const { client } = fakeClient(ok([]), {
    data: null,
    error: {
      code: "57014",
      message: SENTINEL,
      details: SENTINEL,
      hint: SENTINEL,
    },
    status: 500,
  });
  const error: unknown = await read(client).catch((e: unknown) => e);
  expect(isLoggedError(error)).toBe(true);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    level: "error",
    event: "portfolio_setup.read",
    "plant.outcome": "error",
    "plant.portfolio_setup.list": "archived",
    "error.type": "57014",
  });
  expect(JSON.stringify(lines)).not.toContain(SENTINEL);
});

it("logs one line when both lists fail", async () => {
  const lost: Response = { data: null, error: null, status: 0 };
  const { client } = fakeClient(lost, lost);
  await expect(read(client)).rejects.toThrow("portfolio_setup.read_failed");
  expect(lines).toEqual([
    expect.objectContaining({
      "plant.portfolio_setup.list": "both",
      "error.type": "fetch_error",
    }),
  ]);
});

it("names the active list when only it fails", async () => {
  const { client } = fakeClient(
    { data: null, error: { code: "57014" }, status: 500 },
    ok([]),
  );
  await expect(read(client)).rejects.toThrow("portfolio_setup.read_failed");
  expect(lines).toEqual([
    expect.objectContaining({ "plant.portfolio_setup.list": "active" }),
  ]);
});

it("pages archived holders by their own param", async () => {
  const { client, calls } = fakeClient(ok([]), ok([]));
  const view = await readHolders(client, {
    userId: USER,
    requestId: REQUEST_ID,
    params: { titulares: `${AT},${ID}`, carteras: "x" },
  });
  expect(calls[0]![0]).toEqual(["select", "id, name"]);
  expect(calls[1]).toContainEqual(["lte", "archived_at", AT]);
  expect(view.archivedPage).toBe(`${AT},${ID}`);
  expect(view.archivedFirstHref).toBe("?carteras=x");
});

it("reads accounts with their holder and portfolio", async () => {
  const portfolio = { id: "p1", name: "Principal", archived_at: null };
  const { client, calls } = fakeClient(
    ok([
      {
        id: ID,
        institution: "IOL",
        include_in_tax_report: true,
        holder: null,
        portfolio,
      },
    ]),
    ok([
      {
        id: "c2",
        institution: "Balanz",
        include_in_tax_report: false,
        holder: { id: "h1", name: "Lucía", archived_at: AT },
        portfolio: { ...portfolio, archived_at: AT },
        archived_at: AT,
      },
    ]),
  );
  const view = await readSourceConnections(client, {
    userId: USER,
    requestId: REQUEST_ID,
    params: {},
  });
  expect(calls[0]![0]).toEqual([
    "select",
    "id, institution, include_in_tax_report, " +
      "holder:holders!source_connections_user_id_holder_id_fkey(id, name, archived_at), " +
      "portfolio:portfolios!source_connections_user_id_default_portfolio_id_fkey(id, name, archived_at)",
  ]);
  expect(view.active).toEqual([
    {
      id: ID,
      institution: "IOL",
      includeInTaxReport: true,
      holder: null,
      portfolio: { id: "p1", name: "Principal", archived: false },
    },
  ]);
  expect(view.archived).toEqual([
    {
      id: "c2",
      institution: "Balanz",
      includeInTaxReport: false,
      holder: { id: "h1", name: "Lucía", archived: true },
      portfolio: { id: "p1", name: "Principal", archived: true },
    },
  ]);
});

it("names the table of a failed read", async () => {
  const { client } = fakeClient(
    { data: null, error: { code: "57014" }, status: 500 },
    ok([]),
  );
  await expect(
    readSourceConnections(client, {
      userId: USER,
      requestId: REQUEST_ID,
      params: {},
    }),
  ).rejects.toThrow("portfolio_setup.read_failed");
  expect(lines).toEqual([
    expect.objectContaining({
      "plant.portfolio_setup.table": "source_connections",
    }),
  ]);
});
