jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: mockSessionUser.id }),
}));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
const mockFetchFavicon = jest.fn();
jest.mock("./favicon", () => ({
  ...jest.requireActual("./favicon"),
  fetchFavicon: (...args: unknown[]) => mockFetchFavicon(...args),
}));

const mockSessionUser = { id: "user-1" };

import { captureServerLog } from "@/lib/log/capture-server-log";

import { readInstitutionIcon } from "./read-icon";

beforeEach(() => {
  captureServerLog();
  mockFetchFavicon.mockReset().mockResolvedValue("data:image/png;base64,AA==");
});

it("limits each user on their own, so other users using theirs up locks out nobody", async () => {
  for (let user = 1; user <= 10; user += 1) {
    mockSessionUser.id = `user-${user}`;
    for (let i = 0; i < 10; i += 1) {
      await readInstitutionIcon("https://example.com");
    }
  }
  mockFetchFavicon.mockClear();
  mockSessionUser.id = "user-11";
  expect(await readInstitutionIcon("https://example.com")).toMatchObject({
    ok: true,
  });
  expect(mockFetchFavicon).toHaveBeenCalledTimes(1);
});

it("refuses a user's eleventh read in a minute", async () => {
  mockSessionUser.id = "user-12";
  for (let i = 0; i < 10; i += 1) {
    await readInstitutionIcon("https://example.com");
  }
  expect(await readInstitutionIcon("https://example.com")).toEqual({
    ok: false,
    reason: "limited",
  });
});
