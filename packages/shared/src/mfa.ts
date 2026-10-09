// The claim private.custom_access_token_hook adds to every access token: a JSON
// boolean, true when the user has a verified MFA factor.
export const MFA_ENROLLED_CLAIM = "mfa_enrolled";

// The amr methods that prove the mailbox or the Google account. Supabase Auth
// writes otp for any POST /verify (an email code, but also an SMS or
// phone-change code), magiclink for a link to a known user, email/signup for a
// new user's first link and oauth for any external provider. So they prove the
// mailbox only while the Auth settings pinned in
// apps/web/src/lib/auth/otp-config.test.ts hold.
export const FIRST_FACTOR_METHODS = [
  "otp",
  "magiclink",
  "email/signup",
  "oauth",
] as const;
