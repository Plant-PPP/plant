import { connectMessages, SYNC_MESSAGES } from "@/lib/connections/api-key";

import {
  connectFailure,
  DISCONNECT_FAILED,
  disconnectFailure,
  periodFailure,
  syncFailure,
  yearBefore,
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

it("reads a year of operations back from today, a leap day as the 28th", () => {
  expect(yearBefore("2026-10-14")).toBe("2025-10-14");
  expect(yearBefore("2028-02-29")).toBe("2027-02-28");
});

it.each([
  ["", "2026-10-14", "Elegí las dos fechas."],
  ["1999-12-31", "2026-10-14", "Elegí una fecha desde el año 2000."],
  [
    "2026-10-01",
    "2026-09-01",
    "La fecha de inicio tiene que ser anterior a la de fin.",
  ],
  ["2026-10-01", "2026-10-15", "La fecha de fin no puede ser posterior a hoy."],
  ["2026-01-01", "2026-10-14", null],
])("says why %s to %s cannot be read", (from, to, message) => {
  expect(periodFailure(from, to, "2026-10-14")).toBe(message);
});
