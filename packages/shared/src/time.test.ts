import { buenosAiresDate } from "./time";

describe("buenosAiresDate", () => {
  it.each([
    ["2026-10-09T02:59:59.999Z", "2026-10-08"],
    ["2026-10-09T03:00:00.000Z", "2026-10-09"],
    ["2026-10-09T21:00:00.000Z", "2026-10-09"],
    ["2027-01-01T02:59:59.999Z", "2026-12-31"],
    ["2027-01-01T03:00:00.000Z", "2027-01-01"],
  ])("dates %s as %s", (instant, date) => {
    expect(buenosAiresDate(new Date(instant))).toBe(date);
  });
});
