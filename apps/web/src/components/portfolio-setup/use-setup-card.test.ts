// React's renders and commits are played by hand: refs keep their value across
// renders, the first commit runs every effect, a later one re-runs only the
// effects without dependencies, and leaving runs the first commit's cleanups.
type Effect = (() => (() => void) | void) & { everyCommit: boolean };
const mockRender = { effects: [] as Effect[], refs: [] as unknown[], ref: 0 };
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) =>
    mockRender.effects.push(Object.assign(effect, { everyCommit: !deps })),
  useRef: (initial: unknown) =>
    (mockRender.refs[mockRender.ref++] ??= { current: initial }),
}));
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { toast } from "sonner";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { SetupRun } from "./setup-actions";
import { useSetupCard } from "./setup-card";

const refused: WriteResult = { ok: false, code: "duplicate_name" };
const alert = WRITE_MESSAGES.portfolios.duplicate_name;

function rendered(run: SetupRun, pending: boolean) {
  mockRender.effects = [];
  mockRender.ref = 0;
  // One render of the hook; the mocked hooks above stand in for React's.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const card = useSetupCard({ run, pending });
  return { card, effects: mockRender.effects };
}

// Shows the section, then submits a dialog whose write the test settles.
function submitted() {
  mockRender.refs = [];
  const runs: Parameters<SetupRun>[] = [];
  const run: SetupRun = (...args) => {
    runs.push(args);
    return true;
  };
  const { card, effects } = rendered(run, false);
  const cleanups = effects.map((effect) => effect());
  const reopen = jest.fn();
  card.dialogAction(
    {
      list: "portfolios",
      change: { kind: "create", row: { id: "p1", name: "Principal" } },
    },
    () => Promise.resolve(refused),
    WRITE_MESSAGES.portfolios,
    { done: "Creaste Principal", reopen },
  );
  return {
    reopen,
    settle: (result: WriteResult) => {
      const [, , answerOf, after] = runs[0]!;
      after(answerOf(result));
    },
    // A commit of the section, while the write runs or once it ended.
    commit: (pending: boolean) =>
      rendered(run, pending)
        .effects.filter((effect) => effect.everyCommit)
        .forEach((effect) => effect()),
    leave: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

beforeEach(() => jest.clearAllMocks());

it("reopens the dialog with the alert and toasts nothing once it shows", () => {
  const write = submitted();
  write.settle(refused);
  expect(write.reopen).toHaveBeenCalledWith(alert);
  write.commit(false);
  write.leave();
  expect(toast.error).not.toHaveBeenCalled();
});

it("toasts the alert when the section goes before the reopened dialog shows", () => {
  const write = submitted();
  write.settle(refused);
  write.leave();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith(alert);
});

it("keeps the alert through a commit made while the write still runs", () => {
  const write = submitted();
  write.settle(refused);
  write.commit(true);
  write.leave();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith(alert);
});

it("drops the alert once the write ends after a commit made while it ran", () => {
  const write = submitted();
  write.settle(refused);
  write.commit(true);
  write.commit(false);
  write.leave();
  expect(toast.error).not.toHaveBeenCalled();
});

it("toasts the change and never an alert when the write is done", () => {
  const write = submitted();
  write.settle({ ok: true, id: "p1" });
  write.leave();
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith("Creaste Principal");
  expect(write.reopen).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("toasts the alert instead of reopening when the section is already gone", () => {
  const write = submitted();
  write.leave();
  write.settle(refused);
  expect(write.reopen).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(alert);
});

describe("a refused row action", () => {
  const button = { focus: jest.fn(), closest: () => null };
  const section = {
    querySelector: (selector: string) =>
      selector.includes('"a"') && selector.includes('"archive"')
        ? button
        : null,
  };
  const heading = {
    focus: jest.fn(),
    closest: (selector: string) =>
      selector === '[data-slot="setup-section"]' ? section : null,
  };

  beforeAll(() => {
    Object.assign(globalThis, {
      CSS: { escape: (value: string) => value },
      document: { activeElement: heading, body: {} },
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(globalThis, "CSS");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("returns focus to its button in the heading's section once it ends", () => {
    mockRender.refs = [];
    const runs: Parameters<SetupRun>[] = [];
    const run: SetupRun = (...args) => {
      runs.push(args);
      return true;
    };
    const { card, effects } = rendered(run, false);
    effects.forEach((effect) => effect());
    (mockRender.refs[0] as { current: unknown }).current = heading;
    card.rowAction(
      { list: "portfolios", change: { kind: "archive", id: "a" } },
      () => Promise.resolve(refused),
      () => ({ kind: "alert", text: alert }),
      { done: "Archivaste Principal", rowId: "a", actionId: "archive" },
    );
    const [, , answerOf, after] = runs[0]!;
    after(answerOf(refused));
    expect(button.focus).not.toHaveBeenCalled();
    rendered(run, false)
      .effects.filter((effect) => effect.everyCommit)
      .forEach((effect) => effect());
    expect(button.focus).toHaveBeenCalledTimes(1);
  });
});
