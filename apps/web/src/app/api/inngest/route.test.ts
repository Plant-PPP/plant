// The deployed handler, not just its options: a route that stops passing
// serveOptions would reopen unsigned syncs.
const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  jest.restoreAllMocks();
  process.env = ORIGINAL_ENV;
  global.fetch = ORIGINAL_FETCH;
});

it("rejects an unsigned sync outside development", async () => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "production",
    INNGEST_SIGNING_KEY: `signkey-test-${"ab".repeat(32)}`,
  };
  jest.spyOn(console, "error").mockImplementation(() => {});
  const outbound = jest.fn();
  global.fetch = outbound as unknown as typeof fetch;

  let route!: typeof import("./route");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    route = require("./route");
  });
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
