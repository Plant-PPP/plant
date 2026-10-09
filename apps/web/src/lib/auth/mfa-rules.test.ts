import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MFA_ENROLLED_CLAIM } from "@plant/shared";
import {
  type MfaClaims,
  mfaRequirement,
  sensitiveRequirement,
  STEP_UP_WINDOW_S,
} from "./mfa-rules";

// The truth table the hook and the RESTRICTIVE policy are tested on, parsed
// strictly: a row this parser cannot read fails here instead of being skipped.
function truthTable() {
  const sql = readFileSync(
    join(__dirname, "../../../../../supabase/tests/mfa_gate_test.sql"),
    "utf8",
  );
  const start = sql.indexOf("-- truth-table:start ");
  const end = sql.indexOf("-- truth-table:end");
  if (start === -1 || end < start) throw new Error("truth table not found");
  const [header = "", ...lines] = sql.slice(start, end).trim().split("\n");
  expect(header).toBe(
    `-- truth-table:start aal,${MFA_ENROLLED_CLAIM},expected`,
  );
  return lines.map((line) => {
    const row = line.match(
      /^ {2}\((NULL|'aal1'|'aal2'), (true|false|NULL), '(met|verify)'\)[,;]$/,
    );
    if (!row) throw new Error(`not a truth-table row: ${line}`);
    const [, aal = "", enrolled = "", expected = ""] = row;
    return {
      aal: aal === "NULL" ? undefined : aal.slice(1, -1),
      enrolled: enrolled === "NULL" ? undefined : enrolled === "true",
      expected,
    };
  });
}

describe("mfaRequirement", () => {
  const rows = truthTable();

  it("reads one row for each aal and claim", () => {
    const keys = rows.map((r) => `${r.aal} ${r.enrolled}`);
    expect(new Set(keys).size).toBe(9);
    expect(keys).toHaveLength(9);
  });

  it.each(rows)(
    "aal $aal, claim $enrolled: $expected",
    ({ aal, enrolled, expected }) => {
      const claims: MfaClaims = {};
      if (aal !== undefined) claims.aal = aal;
      if (enrolled !== undefined) claims[MFA_ENROLLED_CLAIM] = enrolled;
      const result = mfaRequirement(claims);
      // The database refuses a token without the claim as it refuses an
      // enrolled one; the app tells the two apart.
      expect(result === "met" ? "met" : "verify").toBe(expected);
      expect(result === "claim_missing").toBe(
        expected === "verify" && enrolled === undefined,
      );
    },
  );

  it.each([["true"], ["false"], [1], [0], [null]])(
    "treats a claim of %p as missing",
    (claim) => {
      expect(mfaRequirement({ aal: "aal1", [MFA_ENROLLED_CLAIM]: claim })).toBe(
        "claim_missing",
      );
    },
  );

  it.each([["aal3"], ["AAL2"], ["aal2 "], [2]])(
    "asks an enrolled session whose aal is %p for the code",
    (aal) => {
      expect(mfaRequirement({ aal, [MFA_ENROLLED_CLAIM]: true })).toBe(
        "verify",
      );
    },
  );
});

describe("sensitiveRequirement", () => {
  const now = 1_800_000_000;
  const signedIn = (method: string, secondsAgo: number) => ({
    amr: [{ method, timestamp: now - secondsAgo }],
  });

  it.each(["otp", "magiclink", "email/signup", "oauth"])(
    "accepts %s within the window",
    (method) => {
      expect(
        sensitiveRequirement(signedIn(method, STEP_UP_WINDOW_S), now),
      ).toBe("met");
    },
  );

  it("asks to sign in again one second past the window", () => {
    expect(
      sensitiveRequirement(signedIn("otp", STEP_UP_WINDOW_S + 1), now),
    ).toBe("sign_in_again");
  });

  it.each([
    "totp",
    "mfa/phone",
    "oauth_provider/authorization_code",
    "password",
    "anonymous",
    "unknown",
  ])("does not count %s as a first factor", (method) => {
    expect(sensitiveRequirement(signedIn(method, 0), now)).toBe(
      "sign_in_again",
    );
  });

  it("counts a recent first factor next to an older one", () => {
    const claims = {
      amr: [
        { method: "totp", timestamp: now },
        { method: "otp", timestamp: now - 60 },
        { method: "oauth", timestamp: now - 86_400 },
      ],
    };
    expect(sensitiveRequirement(claims, now)).toBe("met");
  });

  it("does not count a fresh TOTP verify next to a stale first factor", () => {
    const claims = {
      amr: [
        { method: "totp", timestamp: now },
        { method: "otp", timestamp: now - STEP_UP_WINDOW_S - 1 },
      ],
    };
    expect(sensitiveRequirement(claims, now)).toBe("sign_in_again");
  });

  it.each([
    ["no amr", {}],
    ["a string amr", { amr: ["otp"] }],
    ["an amr object", { amr: { method: "otp", timestamp: now } }],
    [
      "a timestamp as a string",
      {
        amr: [{ method: "otp", timestamp: String(now) }],
      },
    ],
    ["an entry without a timestamp", { amr: [{ method: "otp" }] }],
    ["a null entry", { amr: [null] }],
  ])("asks to sign in again with %s", (_, claims) => {
    expect(sensitiveRequirement(claims, now)).toBe("sign_in_again");
  });
});
