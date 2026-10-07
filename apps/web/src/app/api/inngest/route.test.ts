import { loadWithEnv, restoreEnv, TEST_SIGNING_KEY } from "@plant/jobs/testing";

// The deployed handler, not just its options: a route that stops passing
// serveOptions would reopen unsigned syncs.
const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  jest.restoreAllMocks();
  restoreEnv();
  global.fetch = ORIGINAL_FETCH;
});

it("rejects an unsigned sync outside development", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  const outbound = jest.fn();
  global.fetch = outbound as unknown as typeof fetch;

  const route = loadWithEnv(
    { NODE_ENV: "production", INNGEST_SIGNING_KEY: TEST_SIGNING_KEY },
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require("./route") as typeof import("./route"),
  );
  const res = await route.PUT(
    new Request("https://plant.test/api/inngest", {
      method: "PUT",
      headers: { host: "evil.example" },
    }) as never,
    undefined as never,
  );

  expect(res.status).toBe(401);
  expect(outbound).not.toHaveBeenCalled();
});
