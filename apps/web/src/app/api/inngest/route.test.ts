import {
  loadWithEnv,
  restoreEnv,
  sign,
  TEST_SIGNING_KEY,
} from "@plant/jobs/testing";

jest.mock("server-only", () => ({}), { virtual: true });

// The deployed handler, not just its options: a route that stops building
// them with createServeOptions would reopen unsigned syncs or register the
// quotes job outside development.
const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  jest.restoreAllMocks();
  restoreEnv();
  global.fetch = ORIGINAL_FETCH;
});

const loadRoute = (env: Record<string, string>) =>
  loadWithEnv(
    env,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require("./route") as typeof import("./route"),
  );

type Route = ReturnType<typeof loadRoute>;
const call = (handler: Route["GET"], request: Request) =>
  handler(request as never, undefined as never);

async function functionCount(route: Route, headers: HeadersInit = {}) {
  const res = await call(
    route.GET,
    new Request("https://plant.test/api/inngest", {
      headers: { host: "plant.test", ...headers },
    }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { function_count: number }).function_count;
}

it("rejects an unsigned sync outside development", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  const outbound = jest.fn();
  global.fetch = outbound as unknown as typeof fetch;

  const route = loadRoute({
    NODE_ENV: "production",
    INNGEST_SIGNING_KEY: TEST_SIGNING_KEY,
  });
  const res = await call(
    route.PUT,
    new Request("https://plant.test/api/inngest", {
      method: "PUT",
      headers: { host: "evil.example" },
    }),
  );

  expect(res.status).toBe(401);
  expect(outbound).not.toHaveBeenCalled();
});

it("registers the quotes job under next dev", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  const route = loadRoute({ NODE_ENV: "development" });
  expect(await functionCount(route)).toBe(2);
});

it("registers only ping outside development", async () => {
  const route = loadRoute({
    NODE_ENV: "production",
    INNGEST_SIGNING_KEY: TEST_SIGNING_KEY,
  });
  expect(await functionCount(route, { "x-inngest-signature": sign("") })).toBe(
    1,
  );
});
