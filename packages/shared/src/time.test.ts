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

describe("Buenos Aires day edges", () => {
  it.each([
    ["2026-10-09T03:00:00.000Z", "2026-10-09", 0],
    ["2026-10-10T02:59:59.999Z", "2026-10-09", 23],
  ])("reads %s as %s hour %i", (instant, date, hour) => {
    expect(buenosAiresDate(new Date(instant))).toBe(date);
    expect(buenosAiresHour(new Date(instant))).toBe(hour);
  });

  const monthStarts = Array.from(
    { length: 12 },
    (_, month) => `2026-${String(month + 1).padStart(2, "0")}-01`,
  );
  it.each([
    ...monthStarts,
    "2026-01-31",
    "2026-02-28",
    "2026-12-31",
    "2028-02-29",
    "2000-01-01",
    "2000-02-29",
    "2000-12-31",
    // Summer time started at 00:00, so the day began at 01:00.
    "2008-10-19",
    // Summer time ended at 00:00, back to 23:00 of the day before.
    "2009-03-15",
    "2008-03-16",
  ])("round-trips %s and starts it at its first instant", (date) => {
    const start = startOfBuenosAiresDay(date);
    expect(buenosAiresDate(start)).toBe(date);
    expect(buenosAiresDate(new Date(start.getTime() - 1))).not.toBe(date);
  });

  it.each([
    ["2008-10-19", "2008-10-19T03:00:00.000Z"],
    ["2009-03-15", "2009-03-15T03:00:00.000Z"],
  ])("starts the summer-time switch day %s at %s", (date, instant) => {
    expect(startOfBuenosAiresDay(date).toISOString()).toBe(instant);
  });

  it.each(["2026-02-30", "2026-13-01", "2026-00-10"])(
    "rejects %s, a day that does not exist",
    (date) => {
      expect(() => startOfBuenosAiresDay(date)).toThrow(RangeError);
    },
  );

  it("keeps a year below 100 as written", () => {
    expect(startOfBuenosAiresDay("0050-01-01").getUTCFullYear()).toBe(50);
  });
});
