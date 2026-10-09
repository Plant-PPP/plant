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

function tablesUnder(prefix: string): string[] {
  return [...config.matchAll(/^\[([^\]]+)\]$/gm)]
    .map((m) => m[1] ?? "")
    .filter((name) => name.startsWith(`${prefix}.`))
    .map((name) => name.slice(prefix.length + 1));
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

  // Pasting the whole mail must not hand the code field a number before the code.
  it("has no digit in its text before the code", () => {
    const body = template.slice(
      template.indexOf("</head>"),
      template.indexOf("{{ .Token }}"),
    );
    // The text between tags; comments and attributes sit inside them.
    const text = body
      .split("<")
      .map((part) => part.slice(part.indexOf(">") + 1))
      .join(" ");
    expect(text).not.toMatch(/\d/);
  });
});

// Preconditions of FIRST_FACTOR_METHODS (packages/shared/src/mfa.ts), of TOTP
// being the only MFA factor, and of Auth calling the access token hook. The
// hosted project keeps its own copy of each setting in the dashboard.
describe("the Auth settings the MFA rules rely on", () => {
  it("allows no MFA factor or passkey but TOTP", () => {
    expect(value("auth.mfa.phone", "enroll_enabled")).toBe("false");
    expect(value("auth.mfa.phone", "verify_enabled")).toBe("false");
    expect(value("auth.mfa.web_authn", "enroll_enabled")).toBe("false");
    expect(value("auth.mfa.web_authn", "verify_enabled")).toBe("false");
    expect(value("auth.passkey", "enabled")).toBe("false");
  });

  it("has no phone sign-in or SMS provider", () => {
    expect(value("auth.sms", "enable_signup")).toBe("false");
    expect(tablesUnder("auth.sms")).toEqual(["twilio"]);
    expect(value("auth.sms.twilio", "enabled")).toBe("false");
  });

  it("confirms a new address, and an email change on both addresses", () => {
    expect(value("auth.email", "enable_confirmations")).toBe("true");
    expect(value("auth.email", "double_confirm_changes")).toBe("true");
  });

  it("allows no anonymous sign-in and no manual identity linking", () => {
    expect(value("auth", "enable_anonymous_sign_ins")).toBe("false");
    expect(value("auth", "enable_manual_linking")).toBe("false");
  });

  it("signs in with no external provider but Google", () => {
    const providers = tablesUnder("auth.external");
    expect(providers).toContain("google");
    for (const provider of providers.filter((p) => p !== "google")) {
      expect(value(`auth.external.${provider}`, "enabled")).toBe("false");
    }
  });

  it("calls no Auth hook but the access token hook", () => {
    expect(value("auth.hook.custom_access_token", "uri")).toBe(
      '"pg-functions://postgres/private/custom_access_token_hook"',
    );
    for (const hook of tablesUnder("auth.hook")) {
      expect([hook, value(`auth.hook.${hook}`, "enabled")]).toEqual([
        hook,
        hook === "custom_access_token" ? "true" : "false",
      ]);
    }
  });

  it("accepts no third-party, Web3 or OAuth server tokens", () => {
    for (const prefix of ["auth.third_party", "auth.web3"]) {
      for (const provider of tablesUnder(prefix)) {
        expect(value(`${prefix}.${provider}`, "enabled")).toBe("false");
      }
    }
    expect(value("auth.oauth_server", "enabled")).toBe("false");
  });
});
