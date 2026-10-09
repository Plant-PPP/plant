import { unstable_rethrow } from "next/navigation";

// A server action's answer, or "rejected" when the call itself failed. The
// redirect of an ended session is rethrown so Next navigates instead of an
// alert.
export function settle<T>(call: Promise<T>): Promise<T | "rejected"> {
  return call.catch((error: unknown) => {
    unstable_rethrow(error);
    return "rejected" as const;
  });
}
