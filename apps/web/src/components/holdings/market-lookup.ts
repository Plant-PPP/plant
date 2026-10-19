import { exactListing, type ListingMarket } from "@plant/core";
import { usTicker } from "@plant/shared";

import type { InstrumentRow } from "@/lib/holdings/read";
import { settle } from "@/lib/server-action-call";

import type { InstrumentMarket } from "./instrument-market";

// Answers that stop the lookups: a limit or a market that is down.
const STOPS: ReadonlySet<string> = new Set(["limited", "unavailable"]);

// Looks up in the market, one at a time, each name an import gave an
// instrument the catalog lacks, and adds its exact listing: a US listing's
// symbol as it is (the server checks it with the market), anything else
// after a search. usd: the name is a dollar line. A limit or an outage stops
// the walk; it answers how many names were left unasked.
export async function lookUpNames(
  names: readonly string[],
  markets: readonly ListingMarket[],
  market: InstrumentMarket,
  found: (name: string, instrument: InstrumentRow, usd: boolean) => void,
): Promise<number> {
  const listed = async (name: string) => {
    if (usTicker(name) !== null) {
      return markets.includes("us")
        ? { symbol: name, market: "us" as const, line: null }
        : null;
    }
    const answer = await settle(market.search(name, markets));
    if (answer === "rejected" || !answer.ok) return null;
    const exact = exactListing(answer.listings, name);
    return exact && { ...exact.listing, line: exact.line };
  };
  for (const [at, name] of names.entries()) {
    const listing = await listed(name);
    if (!listing) continue;
    const added = await settle(market.add(listing.symbol, listing.market));
    if (added !== "rejected" && added.ok) {
      found(name, added.instrument, listing.line !== null);
    } else if (added === "rejected" || STOPS.has(added.code)) {
      return names.length - at;
    }
  }
  return 0;
}
