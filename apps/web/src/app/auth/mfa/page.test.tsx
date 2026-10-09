import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";

const readSessionClaims = jest.fn();
const listFactors = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`redirect ${url}`);
});
const log = { warn: jest.fn(), error: jest.fn() };

jest.mock("server-only", () => ({}), { virtual: true });
const REQUEST_ID = "6f1c2d3e-4a5b-4c7d-8e9f-0a1b2c3d4e5f";
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-request-id": REQUEST_ID }),
}));
jest.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
jest.mock("@/lib/auth/session-claims-unchecked", () => ({
  readSessionClaims: () => readSessionClaims(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { mfa: { listFactors } } }),
}));
jest.mock("@/lib/log/server-log", () => ({ serverLog: log }));
jest.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/auth/sign-out-everywhere", () => ({
  SignOutEverywhere: () => <button>sign out everywhere</button>,
}));
jest.mock("@/components/mfa/mfa-challenge-form", () => ({
  MfaChallengeForm: (props: { factorId: string; next: string }) => (
    <form data-factor={props.factorId} data-next={props.next} />
  ),
}));

import MfaPage from "./page";

const UNVERIFIED = { sub: "u1", aal: "aal1", mfa_enrolled: true };
const totp = { id: "f1", factor_type: "totp", status: "verified" };

async function render(next?: string | string[]) {
  return renderToStaticMarkup(
    await MfaPage({ searchParams: Promise.resolve({ next }) }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  readSessionClaims.mockResolvedValue(UNVERIFIED);
});

it("sends a session that needs no verification where it was going", async () => {
  readSessionClaims.mockResolvedValue({ ...UNVERIFIED, aal: "aal2" });
  await expect(render("/assets")).rejects.toThrow("redirect /assets");
  expect(listFactors).not.toHaveBeenCalled();
});

it("forwards a user without a factor", async () => {
  readSessionClaims.mockResolvedValue({ ...UNVERIFIED, mfa_enrolled: false });
  await expect(render("/assets")).rejects.toThrow("redirect /assets");
  expect(listFactors).not.toHaveBeenCalled();
});

it("shows the form for the user's TOTP factor, keeping the first next", async () => {
  listFactors.mockResolvedValue({
    data: { all: [totp], totp: [totp] },
    error: null,
  });
  const html = await render(["/debts", "/assets"]);
  expect(html).toContain('data-factor="f1"');
  expect(html).toContain('data-next="/debts"');
  expect(log.warn).not.toHaveBeenCalled();
  expect(log.error).not.toHaveBeenCalled();
});

it("drops a next that would land back on this step", async () => {
  listFactors.mockResolvedValue({
    data: { all: [totp], totp: [totp] },
    error: null,
  });
  expect(await render("/auth/mfa")).toContain('data-next="/"');
});

it("says so, and logs it, when the user has no TOTP factor", async () => {
  listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
  const html = await render();
  expect(html).toContain("No encontramos tu app de autenticación.");
  expect(html).not.toContain("<form");
  expect(html).toContain("sign out everywhere");
  expect(log.warn).toHaveBeenCalledWith("auth.mfa_page", {
    "plant.request_id": REQUEST_ID,
    "enduser.id": "u1",
    "plant.outcome": "no_totp_factor",
  });
});

it.each([
  new AuthSessionMissingError(),
  new AuthApiError("User not found", 403, "user_not_found"),
])("sends a session that has ended to sign in again (%p)", async (error) => {
  listFactors.mockResolvedValue({ data: null, error });
  await expect(render("/debts")).rejects.toThrow(
    "redirect /login?next=%2Fdebts&error=signed_out",
  );
  expect(log.warn).toHaveBeenCalledWith(
    "auth.mfa_page",
    expect.objectContaining({ "plant.outcome": "session_ended" }),
  );
  expect(log.error).not.toHaveBeenCalled();
});

it("never shows the form or 'no factor' when the list fails", async () => {
  const error = new Error("down");
  listFactors.mockResolvedValue({ data: null, error });
  const html = await render();
  expect(html).toContain("No pudimos cargar tu verificación.");
  expect(html).not.toContain("<form");
  expect(log.error).toHaveBeenCalledWith(
    "auth.mfa_page",
    expect.objectContaining({ "plant.outcome": "factors_unavailable" }),
    error,
  );
  expect(log.warn).not.toHaveBeenCalled();
});
