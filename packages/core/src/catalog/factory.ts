import { searchYahoo } from "../quotes/adapters/yahoo/search";
import {
  type CatalogSearch,
  type CatalogSearchDeps,
  createCatalogSearch,
} from "./listings";

// The market search with each market's provider: the only catalog file that
// names one beyond those listings.ts reads itself.
export function marketSearch(
  deps: Omit<CatalogSearchDeps, "us">,
): CatalogSearch {
  return createCatalogSearch({
    ...deps,
    us: async (query) =>
      (await searchYahoo(deps.getJson, query)).map((listing) => ({
        ...listing,
        currency: "USD",
        market: "us",
      })),
  });
}
