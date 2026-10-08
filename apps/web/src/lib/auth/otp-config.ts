// supabase/config.toml [auth.email] and the mail template must agree;
// otp-config.test.ts reads both.
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 60;
