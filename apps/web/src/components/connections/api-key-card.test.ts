import { connectMessages, SYNC_MESSAGES } from "@/lib/connections/api-key";

import {
  connectFailure,
  DISCONNECT_FAILED,
  disconnectFailure,
  syncFailure,
} from "./api-key-card";

const down = () => Promise.reject(new Error("network"));

it("reads a call that could not reach the server as failed", async () => {
  expect(await syncFailure(down())).toBe(SYNC_MESSAGES.failed);
  expect(await disconnectFailure(down())).toBe(DISCONNECT_FAILED);
  expect(await connectFailure(down(), "Bitso")).toBe(
    connectMessages("Bitso").failed,
  );
});

it("says why the server refused, and nothing when it went through", async () => {
  expect(
    await syncFailure(Promise.resolve({ ok: false, code: "in_progress" })),
  ).toBe(SYNC_MESSAGES.in_progress);
  expect(
    await syncFailure(Promise.resolve({ ok: true, importId: "i1" })),
  ).toBeNull();
  expect(await disconnectFailure(Promise.resolve({ ok: false }))).toBe(
    DISCONNECT_FAILED,
  );
  expect(await disconnectFailure(Promise.resolve({ ok: true }))).toBeNull();
  expect(
    await connectFailure(
      Promise.resolve({ ok: false, code: "rejected" }),
      "Bitso",
    ),
  ).toBe(connectMessages("Bitso").rejected);
  expect(await connectFailure(Promise.resolve({ ok: true }), "Bitso")).toBe(
    null,
  );
});
