import { createHmac } from "node:crypto";

// Invented key in Inngest's format; never a real one.
const KEY = `signkey-test-${"ab".repeat(32)}`;
const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;

type Handler = (req: Request) => Promise<Response>;

function loadHandler(env: Record<string, string | undefined>): Handler {
  process.env = { ...ORIGINAL_ENV, NODE_ENV: "production", ...env };
  let handler!: Handler;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { serve } = require("inngest/edge") as typeof import("inngest/edge");
    const { serveOptions } = require("./index") as typeof import("./index");
    /* eslint-enable @typescript-eslint/no-require-imports */
    handler = serve(serveOptions) as Handler;
  });
  return handler;
}

function request(
  method: string,
  body?: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://plant.test/api/inngest", {
    method,
    body,
    headers: {
      host: "plant.test",
      "content-type": "application/json",
      ...headers,
    },
  });
}

function sign(body: string): string {
  const timestamp = Math.round(Date.now() / 1000).toString();
  const signature = createHmac("sha256", KEY.replace(/^signkey-\w+-/, ""))
    .update(body + timestamp)
    .digest("hex");
  return `t=${timestamp}&s=${signature}`;
}

let outbound: jest.Mock;
beforeEach(() => {
  // The SDK logs every rejected request; the assertions cover them.
  jest.spyOn(console, "error").mockImplementation(() => {});
  outbound = jest.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  global.fetch = outbound as unknown as typeof fetch;
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = ORIGINAL_ENV;
  global.fetch = ORIGINAL_FETCH;
});

describe("/api/inngest outside development", () => {
  it("rejects unsigned GET and POST, even with INNGEST_DEV=1", async () => {
    const handler = loadHandler({ INNGEST_SIGNING_KEY: KEY, INNGEST_DEV: "1" });
    expect((await handler(request("GET"))).status).toBe(401);
    expect((await handler(request("POST", "{}"))).status).toBe(401);
  });

  it("rejects an unsigned sync without calling Inngest", async () => {
    const handler = loadHandler({ INNGEST_SIGNING_KEY: KEY });
    const res = await handler(request("PUT", "", { host: "evil.example" }));
    expect(res.status).toBe(401);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("fails closed without a signing key", async () => {
    const handler = loadHandler({ INNGEST_SIGNING_KEY: undefined });
    expect((await handler(request("POST", "{}"))).status).toBe(500);
  });

  it("accepts a signed in-band sync, as the dashboard sends it", async () => {
    const handler = loadHandler({ INNGEST_SIGNING_KEY: KEY });
    const body = JSON.stringify({ url: "https://plant.test/api/inngest" });
    const res = await handler(
      request("PUT", body, {
        "x-inngest-sync-kind": "in_band",
        "x-inngest-signature": sign(body),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-inngest-sync-kind")).toBe("in_band");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("answers a signed introspection", async () => {
    const handler = loadHandler({ INNGEST_SIGNING_KEY: KEY });
    const res = await handler(
      request("GET", undefined, { "x-inngest-signature": sign("") }),
    );
    expect(res.status).toBe(200);
  });
});
