import { firstPageHref, keysetFilter, keysetHref, parseKeyset } from "./keyset";

const ID = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const AT = "2026-10-09T14:18:15.123456+00:00";

describe("parseKeyset", () => {
  test("a missing param is the first page", () => {
    expect(parseKeyset(undefined)).toEqual({ ok: true, cursor: null });
  });

  test("accepts the widest offset Postgres reads", () => {
    expect(parseKeyset(`2026-10-09T00:00:00-15:59,${ID}`).ok).toBe(true);
  });

  test("keeps the timestamp exactly as PostgREST wrote it", () => {
    expect(parseKeyset(`${AT},${ID}`)).toEqual({
      ok: true,
      cursor: { at: AT, id: ID },
    });
  });

  test.each([
    "",
    AT,
    `${AT},${ID},x`,
    `${AT},1`,
    `2026-10-09 14:18:15+00,${ID}`,
    `x),user_id.not.is.null,and(id.lt.${ID}`,
    `${AT}),or(id.gt.0,${ID}`,
    `0000-01-01T00:00:00Z,${ID}`,
    `2026-10-09T00:00:00+23:59,${ID}`,
    `2026-10-09T00:00:00-16:00,${ID}`,
    `2026-10-09T00:00:00.${"1".repeat(7)}+00:00,${ID}`,
    `2026-10-09T00:00:00.${"1".repeat(200)}Z,${ID}`,
  ])("refuses %j", (raw) => {
    expect(parseKeyset(raw)).toEqual({ ok: false });
  });

  test("refuses a repeated param", () => {
    expect(parseKeyset([`${AT},${ID}`, `${AT},${ID}`])).toEqual({ ok: false });
  });
});

test("keysetFilter gives the rows after the cursor", () => {
  expect(keysetFilter("archived_at", { at: AT, id: ID })).toBe(
    `archived_at.lt."${AT}",and(archived_at.eq."${AT}",id.lt.${ID})`,
  );
});

describe("keysetHref", () => {
  test("sets its own param and keeps the others", () => {
    const href = keysetHref(
      { titulares: "a,b", carteras: "old", tags: ["x", "y"] },
      "carteras",
      { at: AT, id: ID },
    );
    const search = new URLSearchParams(href.slice(1));
    expect(search.getAll("titulares")).toEqual(["a,b"]);
    expect(search.getAll("tags")).toEqual(["x", "y"]);
    expect(search.getAll("carteras")).toEqual([`${AT},${ID}`]);
  });

  test("round-trips through parseKeyset", () => {
    const href = keysetHref({}, "carteras", { at: AT, id: ID });
    const raw = new URLSearchParams(href.slice(1)).get("carteras") ?? "";
    expect(parseKeyset(raw)).toEqual({ ok: true, cursor: { at: AT, id: ID } });
  });
});

test("firstPageHref drops its own param and keeps the others", () => {
  expect(
    firstPageHref({ carteras: `${AT},${ID}`, titulares: "a" }, "carteras"),
  ).toBe("?titulares=a");
  expect(firstPageHref({ carteras: `${AT},${ID}` }, "carteras")).toBe("?");
});
