// The hook's state, as the last value each setter received.
const mockState: unknown[] = [];
const mockEffects: (() => (() => void) | void)[] = [];
jest.mock("react", () => ({
  useEffect: (effect: () => (() => void) | void) => mockEffects.push(effect),
  useState: (initial: unknown) => {
    const slot = mockState.length;
    mockState.push(initial);
    return [initial, (value: unknown) => (mockState[slot] = value)];
  },
}));

import { attempt, useAuthRequest } from "./use-auth-request";

beforeEach(() => {
  mockState.length = 0;
  mockEffects.length = 0;
});

it("starts with the error it was given", () => {
  useAuthRequest(() => undefined, "copy");
  expect(mockState).toEqual(["copy", false]);
});

it("re-enables the buttons when Back restores the page from the cache", () => {
  const listeners = new Map<string, (event: unknown) => void>();
  Object.assign(globalThis, {
    window: {
      addEventListener: (type: string, fn: (event: unknown) => void) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    },
  });
  useAuthRequest(() => undefined);
  // [error, pending]
  expect(mockState).toEqual([undefined, false]);
  const cleanup = mockEffects[0]!();
  mockState[1] = true;
  listeners.get("pageshow")!({ persisted: false });
  expect(mockState[1]).toBe(true);
  listeners.get("pageshow")!({ persisted: true });
  expect(mockState[1]).toBe(false);
  cleanup?.();
  expect(listeners.has("pageshow")).toBe(false);
  delete (globalThis as { window?: unknown }).window;
});

describe("run", () => {
  const toMessage = (failure: { code?: string }) => `copy:${failure.code}`;

  it("keeps pending after a success and clears the error", async () => {
    const { run } = useAuthRequest(toMessage, "earlier");
    await expect(run(async () => null)).resolves.toBe(true);
    // [error, pending]
    expect(mockState).toEqual([undefined, true]);
  });

  it("shows a thrown error's copy and re-enables the buttons", async () => {
    const { run } = useAuthRequest(toMessage);
    await expect(
      run(async () => {
        throw { code: "mfa_verification_failed" };
      }),
    ).resolves.toBe(false);
    expect(mockState).toEqual(["copy:mfa_verification_failed", false]);
  });
});

it("keeps the code of a thrown Auth error", async () => {
  await expect(
    attempt(async () => {
      throw Object.assign(new Error("Invalid TOTP code entered"), {
        code: "mfa_verification_failed",
      });
    }),
  ).resolves.toEqual({ code: "mfa_verification_failed", name: "Error" });
});

it.each([new Error("network"), null, "text", { code: 42 }])(
  "reads %p thrown as a failure without a code",
  async (thrown) => {
    await expect(
      attempt(async () => {
        throw thrown;
      }),
    ).resolves.toEqual(expect.objectContaining({ code: undefined }));
  },
);

it("passes a returned failure or success through", async () => {
  await expect(attempt(async () => ({ code: "x" }))).resolves.toEqual({
    code: "x",
  });
  await expect(attempt(async () => null)).resolves.toBeNull();
});
