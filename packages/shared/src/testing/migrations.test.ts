import { functionBodies, migrations } from "./migrations";

describe("migrations", () => {
  it("reads every migration in the order they apply", () => {
    const files = migrations().map(({ file }) => file);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual([...files].sort());
  });

  it("keeps a function's latest body and forgets a dropped one", () => {
    const create = (body: string) =>
      `CREATE OR REPLACE FUNCTION private.guard_thing_write()\n  RETURNS trigger\n  SET search_path = ''\n  AS $$${body}$$;`;
    const name = /guard_\w+_write/;
    expect(
      functionBodies([create("first"), create("second")], name).get(
        "guard_thing_write",
      ),
    ).toBe("second");
    expect(
      functionBodies(
        [create("first"), "DROP FUNCTION private.guard_thing_write();"],
        name,
      ).has("guard_thing_write"),
    ).toBe(false);
    expect(
      functionBodies(
        [
          create("first"),
          "DROP FUNCTION private.guard_thing_write();",
          create("again"),
        ],
        name,
      ).get("guard_thing_write"),
    ).toBe("again");
  });

  it("refuses a function it cannot read the body of", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION private.guard_thing_write()",
      "  RETURNS trigger LANGUAGE sql AS 'select 1';",
      "DROP FUNCTION private.guard_thing_write();",
    ].join("\n");
    expect(() => functionBodies([sql], /guard_\w+_write/)).toThrow(
      "no $$ body for private.guard_thing_write()",
    );
  });

  it("never reads the next function's body as an unreadable one's", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION private.guard_one_write()",
      "  RETURNS trigger LANGUAGE sql AS 'select 1';",
      "CREATE OR REPLACE FUNCTION private.guard_two_write()",
      "  RETURNS trigger AS $$two$$;",
    ].join("\n");
    expect(() => functionBodies([sql], /guard_\w+_write/)).toThrow(
      "no $$ body for private.guard_one_write()",
    );
  });

  it("reads past an unreadable function it was not asked for", () => {
    const sql = [
      "CREATE OR REPLACE FUNCTION private.other_check()",
      "  RETURNS trigger LANGUAGE sql AS 'select 1';",
      "CREATE OR REPLACE FUNCTION private.guard_thing_write()",
      "  RETURNS trigger AS $$body$$;",
    ].join("\n");
    expect(functionBodies([sql], /guard_\w+_write/)).toEqual(
      new Map([["guard_thing_write", "body"]]),
    );
  });

  it("forgets a function dropped if it exists", () => {
    expect(
      functionBodies(
        [
          "CREATE FUNCTION private.guard_thing_write() RETURNS trigger AS $$b$$;",
          "DROP FUNCTION IF EXISTS private.guard_thing_write();",
        ],
        /guard_\w+_write/,
      ).size,
    ).toBe(0);
  });

  it("reads a lowercase drop", () => {
    expect(
      functionBodies(
        [
          "CREATE FUNCTION private.guard_thing_write() RETURNS trigger AS $$b$$;",
          "drop function private.guard_thing_write();",
        ],
        /guard_\w+_write/,
      ).size,
    ).toBe(0);
  });
});
