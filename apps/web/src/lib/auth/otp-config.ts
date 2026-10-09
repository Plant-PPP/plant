// supabase/config.toml [auth.email] and the mail template must agree;
// otp-config.test.ts reads both.
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 60;
// Auth's TOTP codes are always six digits. CodeInput serves both codes, so the
// mail code keeps this length too (otp-config.test.ts).
export const TOTP_CODE_LENGTH = 6;
