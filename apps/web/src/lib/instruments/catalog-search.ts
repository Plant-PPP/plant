import "server-only";
import { type CatalogSearch, createCatalogSearch } from "@plant/core";

import { getJson, postForm } from "@/lib/quotes/get-json";
import { iolCredentials } from "@/lib/quotes/iol-credentials";

let search: CatalogSearch | null = null;

// One search per instance, so IOL's panels and its token are read once and
// kept while they last.
export function catalogSearch(): CatalogSearch {
  search ??= createCatalogSearch({ getJson, postForm, iol: iolCredentials() });
  return search;
}
