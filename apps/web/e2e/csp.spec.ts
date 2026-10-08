import { expect, type Page, test } from "@playwright/test";
import { loginErrorMessage } from "@/lib/auth/login-errors";
import { CSP_HEADER } from "@/lib/csp";

const NONCE = /'nonce-([^']+)'/;

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

function expectNoncedScripts(html: string, nonce: string | undefined) {
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
}

// Collected from page load: an init script runs outside the page's CSP.
async function trackViolations(page: Page): Promise<() => Promise<string[]>> {
  const logged: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) {
      logged.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __cspViolations: seen });
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => [
    ...logged,
    ...(await page.evaluate(
      () =>
        (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
  ];
}

test("/login sends one strict CSP and every script carries its nonce", async ({
  request,
}) => {
  const res = await request.get("/login");
  const csps = res
    .headersArray()
    .filter(({ name }) => name.toLowerCase() === CSP_HEADER);
  expect(csps).toHaveLength(1);
  const csp = csps[0]!.value;

  const scriptSrc = directive(csp, "script-src");
  expect(scriptSrc).not.toContain("'unsafe-eval'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  const nonce = csp.match(NONCE)?.[1];
  expect(nonce).toBeDefined();
  expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);

  expectNoncedScripts(await res.text(), nonce);
});

// eval called from page.evaluate is not held to the page's CSP, so the probe
// rides in the served HTML as a nonced script of the page's own.
test("the CSP blocks eval", async ({ page }) => {
  await page.route("**/login", async (route) => {
    const response = await route.fetch();
    const nonce = response.headers()[CSP_HEADER]?.match(NONCE)?.[1];
    const probe = `<script nonce="${nonce}">
      const root = document.documentElement.dataset;
      try { eval("1"); root.evalProbe = "allowed"; } catch (e) { root.evalProbe = e.name; }
      try { new Function("return 1")(); root.functionProbe = "allowed"; } catch (e) { root.functionProbe = e.name; }
    </script>`;
    const headers = { ...response.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({
      response,
      headers,
      body: (await response.text()).replace("</head>", `${probe}</head>`),
    });
  });
  await page.goto("/login");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-eval-probe", "EvalError");
  await expect(html).toHaveAttribute("data-function-probe", "EvalError");
});

test("/login hydrates and talks to Supabase with no CSP violation", async ({
  page,
}) => {
  const violations = await trackViolations(page);
  await page.goto("/login");
  // Next mounts its route announcer once React has hydrated.
  await page.locator("next-route-announcer").waitFor({ state: "attached" });

  await page.getByPlaceholder("nombre@ejemplo.com").fill("e2e@plantia.io");
  await page.getByRole("button", { name: "Recibir código" }).click();
  // Hydrated, the form calls Supabase, which is not running; unhydrated, it
  // would submit natively and show no error.
  await expect(
    page.getByRole("alert").filter({ hasText: loginErrorMessage("generic")! }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  expect(await violations()).toEqual([]);
});

test.describe("fixed headers", () => {
  for (const path of ["/login", "/icon.svg"]) {
    test(`on ${path}`, async ({ request }) => {
      const headers = (await request.get(path)).headers();
      expect(headers["strict-transport-security"]).toBe(
        "max-age=63072000; includeSubDomains",
      );
      expect(headers["permissions-policy"]).toBe(
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
      );
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(headers["x-frame-options"]).toBe("DENY");
    });
  }

  // The proxy skips static files, so a CSP here could only come from
  // next.config.ts, where a second policy would compete with the proxy's.
  test("no CSP outside the proxy", async ({ request }) => {
    const headers = (await request.get("/icon.svg")).headers();
    expect(headers[CSP_HEADER]).toBeUndefined();
  });
});

// Next takes the nonce from the request's CSP, and the layout from x-nonce;
// the proxy must replace both before the render reads them.
test("a client's own nonce headers do not reach the page", async ({
  request,
}) => {
  const res = await request.get("/login", {
    headers: {
      [CSP_HEADER]: "script-src 'nonce-attacker'",
      "x-nonce": "attacker",
      "x-request-id": "attacker",
    },
  });
  const nonce = res.headers()[CSP_HEADER]?.match(NONCE)?.[1];
  expect(nonce).toBeDefined();
  expect(nonce).not.toBe("attacker");
  expect(res.headers()["x-request-id"]).not.toBe("attacker");
  const html = await res.text();
  expect(html).not.toContain("attacker");
  expectNoncedScripts(html, nonce);
});

test("the not-found page has the CSP and nonces its scripts", async ({
  request,
}) => {
  // Public, so the proxy renders it rather than redirecting to /login.
  const res = await request.get("/login/missing");
  expect(res.status()).toBe(404);
  const nonce = res.headers()[CSP_HEADER]?.match(NONCE)?.[1];
  expect(nonce).toBeDefined();
  expectNoncedScripts(await res.text(), nonce);
});
