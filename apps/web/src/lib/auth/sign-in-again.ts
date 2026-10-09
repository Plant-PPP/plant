import { loginErrorPath } from "./login-errors";

// This page's path and query, for coming back to it after a sign-in.
export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

// A retry on an ended session can only fail again, so the user signs in and
// comes back to this page.
export function signInAgain(): void {
  window.location.assign(loginErrorPath("signed_out", currentPath()));
}
