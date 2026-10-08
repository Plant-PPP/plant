import { AuthApiError } from "@supabase/supabase-js";
// The parser Next compiles `config.matcher` with.
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { NextRequest } from "next/server";

type GetClaims = (cookies: {
  setAll: (
    cookies: { name: string; value: string; options: object }[],
    headers: Record<string, string>,
  ) => void;
}) => Promise<{ data: { claims: object } | null; error: unknown }>;

let getClaims: GetClaims;
let refreshSession: GetClaims = async () => ({ data: null, error: null });

jest.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: never },
  ) => ({
    auth: {
      getClaims: () => getClaims(options.cookies),
      refreshSession: () => refreshSession(options.cookies),
    },
  }),
}));

import { CSP_HEADER, NONCE_HEADER } from "@/lib/csp";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { config, proxy } from "./proxy";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  for (const key of Object.keys(ENV)) delete process.env[key];
});

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

// What NextResponse.next({ request: { headers } }) forwards to the page.
function forwarded(res: Response, name: string) {
  return res.headers.get(`x-middleware-request-${name}`);
}

const signedIn: GetClaims = async () => ({
  data: { claims: { sub: "u" } },
  error: null,
});

it("sends a signed-out visitor to /login with the refresh's cookies and headers", async () => {
  getClaims = async ({ setAll }) => {
    setAll(
      [{ name: "sb-x-auth-token", value: "", options: { maxAge: 0 } }],
      CACHE_HEADERS,
    );
    return { data: null, error: null };
  };
  const res = await proxy(request("/assets"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(
    "http://localhost:3000/login?next=%2Fassets",
  );
  expect(res.headers.get("set-cookie")).toContain("sb-x-auth-token=");
  for (const [key, value] of Object.entries(CACHE_HEADERS)) {
    expect(res.headers.get(key)).toBe(value);
  }
});

it("lets a signed-out visitor see /login", async () => {
  getClaims = async () => ({ data: null, error: null });
  const res = await proxy(request("/login"));
  expect(res.headers.get("location")).toBeNull();
});

it.each([
  ["/login?next=%2Fassets", "http://localhost:3000/assets"],
  ["/login?next=//evil.example", "http://localhost:3000/"],
  ["/login", "http://localhost:3000/"],
  ["/login?next=%2Fauth%2Fcallback", "http://localhost:3000/"],
  ["/login?error=unknown&next=%2Fassets", "http://localhost:3000/assets"],
])("sends a signed-in user on %s to %s", async (path, location) => {
  getClaims = signedIn;
  const res = await proxy(request(path));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(location);
});

it("shows /login's error to a signed-in user", async () => {
  getClaims = signedIn;
  const res = await proxy(request("/login?error=callback"));
  expect(res.headers.get("location")).toBeNull();
});

it("keeps the session when Auth is unavailable", async () => {
  getClaims = async ({ setAll }) => {
    // auth-js removes the session on a non-retryable refresh error.
    setAll(
      [{ name: "sb-x-auth-token", value: "", options: { maxAge: 0 } }],
      CACHE_HEADERS,
    );
    return {
      data: null,
      error: new AuthApiError("rate limit", 429, "over_request_rate_limit"),
    };
  };
  const res = await proxy(
    request("/assets", { cookie: "sb-x-auth-token=original" }),
  );
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(forwarded(res, "x-plant-auth")).toBe("unavailable");
  expect(forwarded(res, "cookie")).toBe("sb-x-auth-token=original");
});

it("keeps a refresh that succeeded before Auth failed", async () => {
  getClaims = async ({ setAll }) => {
    setAll(
      [{ name: "sb-x-auth-token", value: "new", options: {} }],
      CACHE_HEADERS,
    );
    return {
      data: null,
      error: new AuthApiError("unavailable", 503, "unexpected_failure"),
    };
  };
  const res = await proxy(
    request("/assets", { cookie: "sb-x-auth-token=old" }),
  );
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("set-cookie")).toContain("sb-x-auth-token=new");
  expect(forwarded(res, "cookie")).toBe("sb-x-auth-token=new");
  expect(forwarded(res, "x-plant-auth")).toBe("unavailable");
});

it("shows the retry when Auth does not answer", async () => {
  jest.useFakeTimers();
  try {
    getClaims = () => new Promise(() => {});
    const pending = proxy(request("/assets"));
    await jest.advanceTimersByTimeAsync(5000);
    const res = await pending;
    expect(res.headers.get("location")).toBeNull();
    expect(forwarded(res, "x-plant-auth")).toBe("unavailable");
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  new SyntaxError("Unexpected token"),
  new Error("Invalid UTF-8 sequence"),
  new TypeError("Cannot read properties of null (reading 'alg')"),
])("treats a token auth-js cannot decode as no session: %s", async (thrown) => {
  getClaims = async () => {
    throw thrown;
  };
  const login = await proxy(request("/login"));
  expect(login.status).toBe(200);
  expect(login.headers.get("location")).toBeNull();
  const page = await proxy(request("/assets"));
  expect(page.headers.get("location")).toBe(
    "http://localhost:3000/login?next=%2Fassets",
  );
});

it("does not forward a client's own x-plant-auth", async () => {
  getClaims = signedIn;
  const res = await proxy(
    request("/assets", { "x-plant-auth": "unavailable" }),
  );
  const overridden = res.headers.get("x-middleware-override-headers");
  expect(overridden).not.toBeNull();
  expect(overridden).not.toContain("x-plant-auth");
  expect(forwarded(res, "x-plant-auth")).toBeNull();
});

it("forwards a refreshed session to the page and the browser", async () => {
  getClaims = async ({ setAll }) => {
    setAll(
      [{ name: "sb-x-auth-token", value: "new", options: {} }],
      CACHE_HEADERS,
    );
    return { data: { claims: { sub: "u" } }, error: null };
  };
  const res = await proxy(
    request("/assets", { cookie: "sb-x-auth-token=old" }),
  );
  expect(res.headers.get("location")).toBeNull();
  expect(forwarded(res, "cookie")).toBe("sb-x-auth-token=new");
  expect(res.headers.get("set-cookie")).toContain("sb-x-auth-token=new");
  for (const [key, value] of Object.entries(CACHE_HEADERS)) {
    expect(res.headers.get(key)).toBe(value);
  }
});

it.each([
  ["/assets", true],
  ["/api/inngest", false],
  ["/api/inngest/fn", false],
  ["/api/inngest-admin", true],
  ["/brand/logotipo-mail.png", false],
])("runs on %s: %p", (path, runs) => {
  const [matcher = ""] = config.matcher;
  const parsed = tryToParsePath(matcher);
  expect(new RegExp(parsed.regexStr ?? "").test(path)).toBe(runs);
});

it("passes through without Supabase", async () => {
  for (const key of Object.keys(ENV)) delete process.env[key];
  getClaims = jest.fn();
  const res = await proxy(request("/assets"));
  expect(res.headers.get("location")).toBeNull();
  expect(getClaims).not.toHaveBeenCalled();
});

describe("a token close to expiry", () => {
  const expiringIn =
    (seconds: number): GetClaims =>
    async () => ({
      data: { claims: { sub: "u", exp: Date.now() / 1000 + seconds } },
      error: null,
    });

  it("is refreshed here, so the page does not refresh it again", async () => {
    getClaims = expiringIn(100);
    refreshSession = async ({ setAll }) => {
      getClaims = expiringIn(3600);
      setAll(
        [{ name: "sb-x-auth-token", value: "fresh", options: {} }],
        CACHE_HEADERS,
      );
      return { data: null, error: null };
    };
    const res = await proxy(request("/assets"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toContain("sb-x-auth-token=fresh");
    expect(forwarded(res, "cookie")).toContain("sb-x-auth-token=fresh");
  });

  it("is left alone with more than two minutes to go", async () => {
    getClaims = expiringIn(200);
    refreshSession = jest.fn();
    await proxy(request("/assets"));
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("shows the retry when Auth cannot refresh it", async () => {
    getClaims = expiringIn(100);
    refreshSession = async () => ({
      data: null,
      error: new AuthApiError("unavailable", 503, "unexpected_failure"),
    });
    const res = await proxy(request("/assets"));
    expect(res.headers.get("location")).toBeNull();
    expect(forwarded(res, "x-plant-auth")).toBe("unavailable");
  });
});

describe("the CSP and request id", () => {
  function nonceOf(csp: string | null) {
    return csp?.match(/'nonce-([^']+)'/)?.[1];
  }

  // What the page renders with matches what the browser enforces.
  function expectForwarded(res: Response) {
    const csp = res.headers.get(CSP_HEADER);
    expect(nonceOf(csp)).toBeDefined();
    expect(forwarded(res, CSP_HEADER)).toBe(csp);
    expect(forwarded(res, NONCE_HEADER)).toBe(nonceOf(csp));
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(forwarded(res, REQUEST_ID_HEADER)).toBe(
      res.headers.get(REQUEST_ID_HEADER),
    );
  }

  it("reach a signed-in page", async () => {
    getClaims = signedIn;
    expectForwarded(await proxy(request("/assets")));
  });

  it("reach the retry page", async () => {
    getClaims = async () => ({
      data: null,
      error: new AuthApiError("rate limit", 429, "over_request_rate_limit"),
    });
    const res = await proxy(request("/assets"));
    expect(forwarded(res, "x-plant-auth")).toBe("unavailable");
    expectForwarded(res);
  });

  it("reach the retry page after a refresh", async () => {
    getClaims = async ({ setAll }) => {
      setAll(
        [{ name: "sb-x-auth-token", value: "new", options: {} }],
        CACHE_HEADERS,
      );
      return {
        data: null,
        error: new AuthApiError("unavailable", 503, "unexpected_failure"),
      };
    };
    const res = await proxy(
      request("/assets", { cookie: "sb-x-auth-token=old" }),
    );
    expect(forwarded(res, "x-plant-auth")).toBe("unavailable");
    expect(res.headers.get("set-cookie")).toContain("sb-x-auth-token=new");
    expectForwarded(res);
  });

  it("reach the page without Supabase", async () => {
    for (const key of Object.keys(ENV)) delete process.env[key];
    const res = await proxy(request("/assets"));
    expectForwarded(res);
    expect(res.headers.get(CSP_HEADER)).toContain("connect-src 'self';");
  });

  it("go on the redirect to /login", async () => {
    getClaims = async () => ({ data: null, error: null });
    const res = await proxy(request("/assets"));
    expect(res.status).toBe(307);
    expect(nonceOf(res.headers.get(CSP_HEADER))).toBeDefined();
    expect(res.headers.get(REQUEST_ID_HEADER)).not.toBeNull();
  });

  it("are new on every request", async () => {
    getClaims = signedIn;
    const [a, b] = await Promise.all([
      proxy(request("/assets")),
      proxy(request("/assets")),
    ]);
    expect(nonceOf(a.headers.get(CSP_HEADER))).not.toBe(
      nonceOf(b.headers.get(CSP_HEADER)),
    );
    expect(a.headers.get(REQUEST_ID_HEADER)).not.toBe(
      b.headers.get(REQUEST_ID_HEADER),
    );
  });

  it("replace the client's own", async () => {
    getClaims = signedIn;
    const res = await proxy(
      request("/assets", {
        [CSP_HEADER]: "script-src 'nonce-attacker'",
        [NONCE_HEADER]: "attacker",
        [REQUEST_ID_HEADER]: "attacker",
      }),
    );
    expectForwarded(res);
    expect(forwarded(res, CSP_HEADER)).not.toContain("attacker");
  });

  it("let the browser reach Supabase", async () => {
    getClaims = signedIn;
    const res = await proxy(request("/assets"));
    expect(res.headers.get(CSP_HEADER)).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    );
  });
});
