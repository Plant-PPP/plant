import "server-only";
import { lookup } from "node:dns/promises";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import { userLimiter } from "@/lib/reports/limit";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";

import {
  type FaviconFailure,
  FaviconError,
  fetchFavicon,
  publicOnlyFetch,
  siteUrl,
} from "./favicon";

export type IconResult =
  | { ok: true; website: string; icon: string }
  | { ok: false; reason: FaviconFailure | "failed" };

const EVENT = "institutions.icon";

const lookupAll = async (host: string) =>
  (await lookup(host, { all: true, verbatim: true })).map(
    (each) => each.address,
  );

const { fetch: publicFetch } = publicOnlyFetch(lookupAll);

// Each read makes a few outbound requests, so a user gets ten a minute. In
// memory, per serverless instance.
const limit = userLimiter({ perUser: 10 });

// The icon of the site a signed-in user gives for an account's institution,
// read by Plant's server. Neither the site nor the icon is logged.
export async function readInstitutionIcon(site: unknown): Promise<IconResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();
  let result: IconResult;
  let failure: unknown;
  const url = typeof site === "string" ? siteUrl(site) : null;
  if (!url) {
    result = { ok: false, reason: "url" };
  } else if (!limit(claims.sub)) {
    result = { ok: false, reason: "limited" };
  } else {
    try {
      const icon = await fetchFavicon(url.href, {
        fetch: publicFetch,
        lookup: lookupAll,
      });
      result = { ok: true, website: url.href, icon };
    } catch (error) {
      if (error instanceof FaviconError) {
        result = { ok: false, reason: error.reason };
      } else {
        result = { ok: false, reason: "failed" };
        failure = error;
      }
    }
  }
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.outcome": result.ok ? "ok" : result.reason,
    "plant.duration_ms": Math.round(performance.now() - started),
  };
  if (failure) serverLog.error(EVENT, line, failure);
  else if (result.ok) serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
  return result;
}
