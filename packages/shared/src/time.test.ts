import {
  buenosAiresDate,
  buenosAiresHour,
  startOfBuenosAiresDay,
} from "./time";

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

describe("buenosAiresHour", () => {
  it.each([
    ["2026-10-09T03:00:00.000Z", 0],
    ["2026-10-09T20:59:59.999Z", 17],
    ["2026-10-09T21:00:00.000Z", 18],
    ["2026-10-10T02:59:59.999Z", 23],
  ])("reads %s as hour %i", (instant, hour) => {
    expect(buenosAiresHour(new Date(instant))).toBe(hour);
  });
});

describe("startOfBuenosAiresDay", () => {
  it.each([
    ["2026-10-09", "2026-10-09T03:00:00.000Z"],
    ["2027-01-01", "2027-01-01T03:00:00.000Z"],
    // Argentina kept summer time that season.
    ["2008-12-01", "2008-12-01T02:00:00.000Z"],
  ])("starts %s at %s", (date, instant) => {
    expect(startOfBuenosAiresDay(date).toISOString()).toBe(instant);
  });

  it("is dated that same day", () => {
    expect(buenosAiresDate(startOfBuenosAiresDay("2026-10-09"))).toBe(
      "2026-10-09",
    );
  });

  it.each(["2026-10-9", "09/10/2026", ""])("rejects %j", (date) => {
    expect(() => startOfBuenosAiresDay(date)).toThrow(RangeError);
  });
});
