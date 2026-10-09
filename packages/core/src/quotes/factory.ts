import { createArgentinadatosFeed } from "./adapters/argentinadatos/feed";
import { createDolarapiFeed } from "./adapters/dolarapi/feed";
import { createKrakenFeed } from "./adapters/kraken/feed";
import type { GetJson, QuoteFeedPort, RawQuoteFeed } from "./contract/port";
import { checkBatch, QUOTE_FEED_CODES, QuoteFeedError } from "./contract/quote";

export function toQuoteFeed(raw: RawQuoteFeed): QuoteFeedPort {
  return {
    id: raw.id,
    async read(now) {
      const rows = await raw.readRaw(now);
      const count =
        rows.fxRates.length + rows.prices.length + (rows.unread?.length ?? 0);
      if (count === 0) throw new QuoteFeedError("empty");
      const batch = checkBatch(rows, now, raw.id);
      // Nothing kept and nothing out of its window: a part that failed for a
      // passing reason makes the read retryable, else the source changed what
      // it sends.
      if (batch.refused.invalid.length === count) {
        const passing = rows.unread?.find(({ code }) => QUOTE_FEED_CODES[code]);
        throw new QuoteFeedError(passing?.code ?? "bad_shape");
      }
      return batch;
    },
  };
}

export function quoteFeeds(deps: {
  getJson: GetJson;
}): readonly QuoteFeedPort[] {
  return [
    createDolarapiFeed(deps.getJson),
    createArgentinadatosFeed(deps.getJson),
    createKrakenFeed(deps.getJson),
  ].map(toQuoteFeed);
}
