import "server-only";
import type { IolCredentials } from "@plant/core";

// Plant's own InvertirOnline account, which the quotes job reads CEDEARs and
// bonds with. Null when either variable is unset, so the IOL feed fails
// unconfigured and the other feeds still run.
export function iolCredentials(): IolCredentials | null {
  const username = process.env.IOL_USERNAME;
  const password = process.env.IOL_PASSWORD;
  return username && password ? { username, password } : null;
}
