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
      // Every row and part refused, none for its window: a part whose code a
      // retry can help fails the read with that code; else a read where
      // nothing was read fails with the first part's code, and one whose rows
      // were all refused means the source changed what it sends.
      if (batch.refused.invalid.length === count) {
        const unread = rows.unread ?? [];
        const passing = unread.find(({ code }) => QUOTE_FEED_CODES[code]);
        const [first] = unread;
        const nothingRead = rows.fxRates.length + rows.prices.length === 0;
        throw new QuoteFeedError(
          passing?.code ?? (nothingRead && first ? first.code : "bad_shape"),
        );
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
