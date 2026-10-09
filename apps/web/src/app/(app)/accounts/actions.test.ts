const requestHeaders = new Headers();
const getSessionClaims = jest.fn();
const createClient = jest.fn();
const revalidatePath = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => requestHeaders }));
jest.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: () => getSessionClaims(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";
import {
  archivePortfolio,
  createPortfolio,
  renamePortfolio,
  restorePortfolio,
} from "./actions";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
const SENTINEL = "Cartera secreta";

type Response = {
  data: { id: string }[] | null;
  error: Record<string, unknown> | null;
  status: number;
};

// A query builder that records each call and answers the awaited chain.
function fakeClient(...responses: Response[]) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "insert", "update", "eq", "is", "not"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.select = (...args: unknown[]) => {
    calls.push(["select", ...args]);
    const response = responses.shift();
    if (!response) throw new Error("no response left");
    return Promise.resolve(response);
  };
  createClient.mockResolvedValue(builder);
  return calls;
}

const ok = (...ids: string[]): Response => ({
  data: ids.map((id) => ({ id })),
  error: null,
  status: 200,
});

const refused = (status: number, code: string, hint?: string): Response => ({
  data: null,
  error: {
    code,
    message: `failed for ${SENTINEL}`,
    details: `Key (name)=(${SENTINEL}) already exists.`,
    hint: hint ?? SENTINEL,
  },
  status,
});

let lines: Record<string, unknown>[];

beforeEach(() => {
  jest.resetAllMocks();
  requestHeaders.set("x-request-id", REQUEST_ID);
  getSessionClaims.mockResolvedValue({ sub: USER });
  lines = captureServerLog();
});

afterEach(() => jest.restoreAllMocks());

function onlyLine() {
  expect(lines).toHaveLength(1);
  const [line] = lines;
  expect(JSON.stringify(line)).not.toContain(SENTINEL);
  // Invalid input wrote nothing, so the page is not re-rendered for it.
  if (line!["plant.outcome"] === "invalid") {
    expect(revalidatePath).not.toHaveBeenCalled();
  } else {
    expect(revalidatePath).toHaveBeenCalledWith("/accounts");
  }
  return line!;
}

describe("createPortfolio", () => {
  it("inserts the trimmed name and logs the new id", async () => {
    const calls = fakeClient({ ...ok(ID), status: 201 });
    await expect(createPortfolio({ name: ` ${SENTINEL} ` })).resolves.toEqual({
      ok: true,
      id: ID,
    });
    expect(calls).toEqual([
      ["from", "portfolios"],
      ["insert", { name: SENTINEL }],
      ["select", "id"],
    ]);
    const line = onlyLine();
    expect(Object.keys(line).sort()).toEqual(
      [
        "enduser.id",
        "event",
        "level",
        "plant.outcome",
        "plant.portfolio_setup.action",
        "plant.portfolio_setup.duration_ms",
        "plant.portfolio_setup.row_id",
        "plant.request_id",
      ].sort(),
    );
    expect(line).toMatchObject({
      level: "info",
      event: "portfolio_setup.write",
      "enduser.id": USER,
      "plant.request_id": REQUEST_ID,
      "plant.outcome": "ok",
      "plant.portfolio_setup.action": "create_portfolio",
      "plant.portfolio_setup.row_id": ID,
    });
  });

  it("counts only a 201 as created", async () => {
    fakeClient(ok(ID));
    await expect(createPortfolio({ name: "Otra" })).resolves.toEqual({
      ok: false,
      code: "failed",
    });
    expect(onlyLine()).toMatchObject({
      level: "error",
      "plant.outcome": "error",
      "error.type": "http_200",
    });
  });

  it.each([
    [{ name: "" }],
    [{ name: "x".repeat(41) }],
    [{ name: "\u0000x" }],
    [{}],
    ["Otra"],
    [null],
  ])("refuses %p without a write", async (input) => {
    await expect(createPortfolio(input)).resolves.toEqual({
      ok: false,
      code: "invalid",
    });
    expect(createClient).not.toHaveBeenCalled();
    const line = onlyLine();
    expect(Object.keys(line).sort()).toEqual(
      [
        "enduser.id",
        "event",
        "level",
        "plant.outcome",
        "plant.portfolio_setup.action",
        "plant.portfolio_setup.duration_ms",
        "plant.request_id",
      ].sort(),
    );
    expect(line).toMatchObject({ level: "warn", "plant.outcome": "invalid" });
  });

  it("maps a duplicate name", async () => {
    fakeClient(refused(409, "23505"));
    await expect(createPortfolio({ name: SENTINEL })).resolves.toEqual({
      ok: false,
      code: "duplicate_name",
    });
    expect(onlyLine()).toMatchObject({
      level: "info",
      "plant.outcome": "duplicate_name",
    });
  });

  it("lets the session's redirect through, before anything else", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    getSessionClaims.mockRejectedValue(redirect);
    await expect(createPortfolio({ name: "Otra" })).rejects.toBe(redirect);
    expect(createClient).not.toHaveBeenCalled();
    expect(lines).toHaveLength(0);
  });
});

describe("renamePortfolio", () => {
  it("filters by the session's user and the id", async () => {
    const calls = fakeClient(ok(ID));
    await expect(renamePortfolio(ID, { name: "Nueva" })).resolves.toEqual({
      ok: true,
      id: ID,
    });
    expect(calls).toEqual([
      ["from", "portfolios"],
      ["update", { name: "Nueva" }],
      ["eq", "user_id", USER],
      ["eq", "id", ID],
      ["is", "archived_at", null],
      ["select", "id"],
    ]);
  });

  it("is not_found when no row of the user matched", async () => {
    fakeClient(ok());
    await expect(renamePortfolio(OTHER, { name: "Nueva" })).resolves.toEqual({
      ok: false,
      code: "not_found",
    });
    expect(onlyLine()).toMatchObject({
      level: "warn",
      "plant.outcome": "not_found",
      "plant.portfolio_setup.row_id": OTHER,
    });
  });

  it("fails when more than one row changed", async () => {
    fakeClient(ok(ID, OTHER));
    await expect(renamePortfolio(ID, { name: "Nueva" })).resolves.toEqual({
      ok: false,
      code: "failed",
    });
    expect(onlyLine()).toMatchObject({
      level: "error",
      "error.type": "rows_2",
    });
  });

  it.each([undefined, "1", `${ID},x`, { id: ID }])(
    "refuses the id %p without a write",
    async (id) => {
      await expect(renamePortfolio(id, { name: "Nueva" })).resolves.toEqual({
        ok: false,
        code: "invalid",
      });
      expect(createClient).not.toHaveBeenCalled();
      expect(onlyLine()).not.toHaveProperty(["plant.portfolio_setup.row_id"]);
    },
  );

  it("logs a failure by its code, never PostgREST's text", async () => {
    fakeClient(refused(500, "XX000"));
    await expect(renamePortfolio(ID, { name: SENTINEL })).resolves.toEqual({
      ok: false,
      code: "failed",
    });
    const line = onlyLine();
    expect(Object.keys(line).sort()).toEqual(
      [
        "enduser.id",
        "error.type",
        "event",
        "exception.message",
        "exception.stacktrace",
        "exception.type",
        "level",
        "plant.outcome",
        "plant.portfolio_setup.action",
        "plant.portfolio_setup.duration_ms",
        "plant.portfolio_setup.row_id",
        "plant.request_id",
      ].sort(),
    );
    expect(line).toMatchObject({
      level: "error",
      "plant.outcome": "error",
      "error.type": "XX000",
      "exception.type": "PortfolioSetupError",
      "exception.message": "XX000",
    });
  });
});

describe("archivePortfolio", () => {
  it("only says an active row of the user is archived", async () => {
    const calls = fakeClient(ok(ID));
    await archivePortfolio(ID);
    expect(calls).toEqual([
      ["from", "portfolios"],
      ["update", { archived_at: expect.any(String) }],
      ["eq", "user_id", USER],
      ["eq", "id", ID],
      ["is", "archived_at", null],
      ["select", "id"],
    ]);
  });

  it("maps the last active portfolio's guard", async () => {
    fakeClient(refused(409, "PT409", "last_active_portfolio"));
    await expect(archivePortfolio(ID)).resolves.toEqual({
      ok: false,
      code: "last_active_portfolio",
    });
    expect(onlyLine()).toMatchObject({
      level: "info",
      "plant.outcome": "last_active_portfolio",
      "plant.portfolio_setup.action": "archive_portfolio",
    });
  });

  it("treats an unknown guard hint as a failure", async () => {
    fakeClient(refused(409, "PT409"));
    await expect(archivePortfolio(ID)).resolves.toEqual({
      ok: false,
      code: "failed",
    });
    expect(onlyLine()).toMatchObject({ "error.type": "PT409" });
  });
});

describe("restorePortfolio", () => {
  it("restores, and on a taken name restores with a new one", async () => {
    const calls = fakeClient(refused(409, "23505"), ok(ID));
    await expect(restorePortfolio(ID)).resolves.toEqual({
      ok: false,
      code: "duplicate_name",
    });
    await expect(restorePortfolio(ID, { name: "Nueva" })).resolves.toEqual({
      ok: true,
      id: ID,
    });
    const restore = (patch: object) => [
      ["from", "portfolios"],
      ["update", patch],
      ["eq", "user_id", USER],
      ["eq", "id", ID],
      ["not", "archived_at", "is", null],
      ["select", "id"],
    ];
    expect(calls).toEqual([
      ...restore({ archived_at: null }),
      ...restore({ name: "Nueva", archived_at: null }),
    ]);
    expect(lines.map((line) => line["plant.portfolio_setup.action"])).toEqual([
      "restore_portfolio",
      "restore_rename_portfolio",
    ]);
  });

  it("writes only the new name, whatever else the caller sends", async () => {
    const calls = fakeClient(ok(ID));
    await restorePortfolio(ID, {
      name: "Nueva",
      user_id: OTHER,
      id: OTHER,
      archived_at: "2000-01-01T00:00:00Z",
    });
    expect(calls).toContainEqual([
      "update",
      { name: "Nueva", archived_at: null },
    ]);
  });

  it("refuses a restore input without a name", async () => {
    await expect(restorePortfolio(ID, { user_id: OTHER })).resolves.toEqual({
      ok: false,
      code: "invalid",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a blank new name", async () => {
    await expect(restorePortfolio(ID, { name: " " })).resolves.toEqual({
      ok: false,
      code: "invalid",
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
