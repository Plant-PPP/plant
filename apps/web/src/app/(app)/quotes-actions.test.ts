jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "user-1" }),
}));
jest.mock("@/lib/quotes/request-quotes", () => ({
  requestQuotes: async () => true,
}));

import { refreshPrices } from "./quotes-actions";

afterEach(() => {
  jest.useRealTimers();
});

it("says a request before the close hour finds the last close", async () => {
  // 17:59 and 18:00 in Buenos Aires (UTC-3).
  jest.useFakeTimers({ now: new Date("2026-10-29T20:59:00Z") });
  expect(await refreshPrices()).toEqual({ ok: true, beforeClose: true });
  jest.setSystemTime(new Date("2026-10-29T21:00:00Z"));
  expect(await refreshPrices()).toEqual({ ok: true, beforeClose: false });
});
