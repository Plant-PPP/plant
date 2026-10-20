import type { ApiKeyView } from "@/lib/connections/api-key";
import type { ImportStatus } from "@/lib/imports/review";

const mockEffects: { effect: () => (() => void) | void; deps: unknown[] }[] =
  [];
const mockWatch = jest.fn<() => void, unknown[]>(() => jest.fn());

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) =>
    mockEffects.push({ effect, deps }),
  useId: () => "id",
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => [initial, jest.fn()],
  useTransition: () => [false, jest.fn()],
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock("@/lib/imports/live", () => ({
  watchImports: (...args: unknown[]) => mockWatch(...args),
}));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => "client" }));

import { connectionForm } from "@/lib/connections/api-key";

import { ApiKeyCard } from "./api-key-card";

const apiKey = (status: ImportStatus): ApiKeyView => ({
  provider: "binance",
  keyHint: "abcd",
  connectedOn: "2026-10-01",
  lastSync: {
    importId: "i1",
    status,
    failure: null,
    on: "2026-10-20",
    at: "10:00",
  },
});

const render = (status: ImportStatus, userId?: string) =>
  ApiKeyCard({
    userId,
    accountId: "a1",
    form: connectionForm("binance"),
    apiKey: apiKey(status),
    actions: {
      connect: jest.fn(),
      disconnect: jest.fn(),
      sync: jest.fn(),
      cancel: jest.fn(),
    },
  });

beforeEach(() => {
  mockEffects.length = 0;
  jest.clearAllMocks();
});

it("follows the user's imports while the account's sync is in flight", () => {
  render("reading", "u1");
  mockEffects[0]!.effect();
  expect(mockWatch).toHaveBeenCalledWith("client", "u1", expect.any(Function));
});

it("does not listen once the sync is done", () => {
  render("ready", "u1");
  expect(mockEffects[0]!.effect()).toBeUndefined();
  expect(mockWatch).not.toHaveBeenCalled();
});

it("does not listen without a user, as in the prototype", () => {
  render("reading");
  expect(mockEffects[0]!.effect()).toBeUndefined();
  expect(mockWatch).not.toHaveBeenCalled();
});
