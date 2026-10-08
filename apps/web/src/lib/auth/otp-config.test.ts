import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OTP_EXPIRY_MINUTES,
  OTP_LENGTH,
  RESEND_COOLDOWN_SECONDS,
} from "./otp-config";

const root = join(__dirname, "../../../../..");
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");

// The body of one [table], up to the next table header.
function table(name: string): string {
  const start = config.indexOf(`\n[${name}]\n`);
  if (start === -1) throw new Error(`[${name}] not found`);
  const body = config.slice(start + name.length + 4);
  const end = body.search(/^\[/m);
  return end === -1 ? body : body.slice(0, end);
}

function value(tableName: string, key: string): string {
  const matches = [
    ...table(tableName).matchAll(new RegExp(`^${key} = (.+)$`, "gm")),
  ];
  expect(matches).toHaveLength(1);
  return (matches[0]?.[1] ?? "").trim();
}

describe("supabase/config.toml [auth.email]", () => {
  it("sends codes of OTP_LENGTH digits", () => {
    expect(Number(value("auth.email", "otp_length"))).toBe(OTP_LENGTH);
  });

  it("expires codes after OTP_EXPIRY_MINUTES", () => {
    expect(Number(value("auth.email", "otp_expiry")) / 60).toBe(
      OTP_EXPIRY_MINUTES,
    );
  });

  it("allows a resend every RESEND_COOLDOWN_SECONDS", () => {
    expect(value("auth.email", "max_frequency")).toBe(
      `"${RESEND_COOLDOWN_SECONDS}s"`,
    );
  });
});

describe("the sign-in mail", () => {
  const confirmation = value(
    "auth.email.template.confirmation",
    "content_path",
  );
  const magicLink = value("auth.email.template.magic_link", "content_path");
  const recovery = value("auth.email.template.recovery", "content_path");
  const template = readFileSync(
    join(root, JSON.parse(confirmation) as string),
    "utf8",
  );

  it("is the same file for new and known addresses and a reset", () => {
    expect(magicLink).toBe(confirmation);
    expect(recovery).toBe(confirmation);
  });

  it("shows the code and its expiry", () => {
    expect(template).toContain("{{ .Token }}");
    expect(template).toContain(`vence en ${OTP_EXPIRY_MINUTES} minutos`);
  });
});
