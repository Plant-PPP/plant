import type { ImportItem, ImportStatus } from "@/lib/imports/review";

const mockEffects: { effect: () => (() => void) | void; deps: unknown[] }[] =
  [];
const mockRefresh = jest.fn();
const mockStop = jest.fn();
const mockWatch = jest.fn<() => void, unknown[]>(() => mockStop);

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) =>
    mockEffects.push({ effect, deps }),
  useTransition: () => [false, jest.fn()],
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
jest.mock("@/lib/imports/live", () => ({
  watchImports: (...args: unknown[]) => mockWatch(...args),
}));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => "client" }));

import { UploadImports } from "./upload-imports";

const item = (status: ImportStatus): ImportItem => ({
  id: "i1",
  fileName: "resumen.pdf",
  accountId: "a1",
  status,
  error: null,
  documentDate: null,
  documentTotals: [],
  rows: [],
  createdOn: "2026-10-13",
});

const render = (statuses: ImportStatus[]) =>
  UploadImports({
    userId: "u1",
    accounts: [],
    archivedAccounts: [],
    imports: statuses.map(item),
    used: 0,
    termsAccepted: true,
    actions: {
      start: jest.fn(),
      finish: jest.fn(),
      acceptTerms: jest.fn(),
    },
  });

// The callback watchImports was given.
const onChange = () => mockWatch.mock.calls[0]![2] as () => void;

beforeEach(() => {
  mockEffects.length = 0;
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => jest.useRealTimers());

it("does not listen while no import is queued or being read", () => {
  render(["ready", "failed", "confirmed"]);
  const [{ effect, deps }] = mockEffects as [(typeof mockEffects)[0]];
  expect(effect()).toBeUndefined();
  expect(mockWatch).not.toHaveBeenCalled();
  expect(deps).toEqual([false, "u1", expect.anything()]);
});

it("listens for the user while an import is in flight, re-reading once per burst", () => {
  render(["ready", "reading"]);
  mockEffects[0]!.effect();
  expect(mockWatch).toHaveBeenCalledWith("client", "u1", expect.any(Function));
  onChange()();
  onChange()();
  onChange()();
  jest.advanceTimersByTime(249);
  expect(mockRefresh).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it("stops listening and drops a pending re-read on cleanup", () => {
  render(["queued"]);
  const cleanup = mockEffects[0]!.effect() as () => void;
  onChange()();
  cleanup();
  jest.runAllTimers();
  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(mockRefresh).not.toHaveBeenCalled();
});
