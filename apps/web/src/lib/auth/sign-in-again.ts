import { loginErrorPath } from "./login-errors";

// A retry on an ended session can only fail again, so the user signs in and
// comes back to this page.
export function signInAgain(): void {
  window.location.assign(
    loginErrorPath("signed_out", window.location.pathname),
  );
}
