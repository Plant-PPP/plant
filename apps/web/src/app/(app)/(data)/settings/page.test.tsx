const readAlerts = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/auth/sensitive-session", () => ({
  needsStepUp: async () => false,
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => "req-1",
}));
jest.mock("@/lib/alerts/read", () => ({
  readAlerts: (...args: unknown[]) => readAlerts(...args),
}));
jest.mock("./actions", () => ({}));
jest.mock("@/components/settings/two-factor-card", () => ({
  TwoFactorCard: () => null,
}));
jest.mock("@/components/prototype/prototype-settings", () => ({
  PrototypeSettings: () => null,
}));

import type * as React from "react";

import { captureServerLog } from "@/lib/log/capture-server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { findProps } from "@/test/element-tree";

import SettingsPage from "./page";

const saved = process.env.VERCEL_ENV;
beforeAll(() => {
  process.env.VERCEL_ENV = "production";
});
afterAll(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

const alertsProps = async () => {
  const page = (await SettingsPage()) as React.ReactElement;
  return findProps(page, (props) => "onCreate" in props && "alerts" in props);
};

it("says the alerts could not be read, and logs it with the request", async () => {
  const lines = captureServerLog();
  readAlerts.mockRejectedValue(new Error("down"));
  expect(await alertsProps()).toMatchObject({ alerts: [], readFailed: true });
  expect(lines.at(-1)).toMatchObject({
    event: "alerts.read",
    "plant.outcome": "failed",
    [REQUEST_ID_FIELD]: "req-1",
  });
});

it("hands the card the alerts it read", async () => {
  readAlerts.mockResolvedValue([]);
  expect(await alertsProps()).toMatchObject({ alerts: [], readFailed: false });
});
