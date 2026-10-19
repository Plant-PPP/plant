import { createArgentinadatosFeed } from "./adapters/argentinadatos/feed";
import { createDolarapiFeed } from "./adapters/dolarapi/feed";
import { type Currency, usTicker } from "@plant/shared";

import { expiring } from "../expiring";
import type { InstrumentType } from "../instruments";
import { createIolFeed, type IolCredentials } from "./adapters/iol/feed";
import { createKrakenFeed } from "./adapters/kraken/feed";
import { createYahooFeed } from "./adapters/yahoo/feed";
import type {
  GetJson,
  PostForm,
  QuoteFeedPort,
  RawQuoteFeed,
} from "./contract/port";
import { checkBatch, QUOTE_FEED_CODES, QuoteFeedError } from "./contract/quote";

export function toQuoteFeed(raw: RawQuoteFeed): QuoteFeedPort {
  return {
    id: raw.id,
    async read(now) {
      const rows = await raw.readRaw(now);
      if (rows.idle) {
        return { ...checkBatch(rows, now, raw.id, raw.listed), idle: true };
      }
      const count =
        rows.fxRates.length + rows.prices.length + (rows.unread?.length ?? 0);
      if (count === 0) throw new QuoteFeedError("empty");
      const batch = checkBatch(rows, now, raw.id, raw.listed);
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

export type QuotedInstrument = {
  symbol: string;
  type: InstrumentType;
  currency: Currency;
};

// How long the quotes job keeps the catalog it read: a warm instance runs
// the job many times, and an instrument added since must be quoted.
const CATALOG_TTL_MS = 5 * 60_000;

// iol is null when Plant's IOL account is not configured: that feed fails
// unconfigured and the others read as usual. instruments reads the catalog,
// once for every feed that quotes from it. A US listing is quoted by Yahoo,
// and every other listed instrument by IOL.
export function quoteFeeds(deps: {
  getJson: GetJson;
  postForm: PostForm;
  iol: IolCredentials | null;
  instruments: () => Promise<readonly QuotedInstrument[]>;
  now?: () => number;
}): readonly QuoteFeedPort[] {
  const instruments = expiring(deps.instruments, CATALOG_TTL_MS, deps.now);
  const listedIn = async (us: boolean) =>
    (await instruments()).filter(
      ({ symbol }) => (usTicker(symbol) !== null) === us,
    );
  return [
    createDolarapiFeed(deps.getJson),
    createArgentinadatosFeed(deps.getJson),
    createKrakenFeed(deps.getJson, async () =>
      (await instruments())
        .filter(({ type, currency }) => type === "crypto" && currency === "USD")
        .map(({ symbol }) => symbol),
    ),
    createIolFeed({
      getJson: deps.getJson,
      postForm: deps.postForm,
      credentials: deps.iol,
      instruments: () => listedIn(false),
    }),
    createYahooFeed(deps.getJson, async () =>
      (await listedIn(true)).map(({ symbol }) => symbol),
    ),
  ].map(toQuoteFeed);
}
