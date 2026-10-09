import "server-only";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, requestIdFrom } from "./request-id";

// The id proxy.ts gave the current request, for a page or server action's log
// line; a route handler reads it from its own request. The proxy imports request-id.ts, which stays free of
// next/headers.
export async function currentRequestId(): Promise<string | undefined> {
  return requestIdFrom((await headers()).get(REQUEST_ID_HEADER));
}
