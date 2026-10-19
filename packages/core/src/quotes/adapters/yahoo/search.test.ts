import { searchUrl, yahooListings } from "./search";

// Yahoo's answer for "VOO", recorded on 2026-10-19 (fields Plant reads).
const VOO_SEARCH = {
  quotes: [
    {
      symbol: "VOO",
      shortname: "Vanguard S&P 500 ETF",
      longname: "Vanguard S&P 500 ETF",
      quoteType: "ETF",
      exchange: "PCX",
    },
    {
      symbol: "VOOG",
      shortname: "Vanguard S&P 500 Growth ETF",
      longname: "Vanguard S&P 500 Growth Index Fund ETF Shares",
      quoteType: "ETF",
      exchange: "PCX",
    },
    {
      symbol: "VOOB",
      shortname: "VistaShares Shield S&P 500 Enha",
      quoteType: "ETF",
      exchange: "NGM",
    },
    {
      symbol: "VOO.MX",
      shortname: "VANGUARD INDEX FUNDS S&P 500 ET",
      longname: "Vanguard S&P 500 ETF",
      quoteType: "ETF",
      exchange: "MEX",
    },
    {
      symbol: "VOO261127C00747500",
      shortname: "VOO Nov 2026 747.500 call",
      quoteType: "OPTION",
      exchange: "OPR",
    },
    {
      symbol: "BRK-B",
      longname: "Berkshire Hathaway Inc.",
      quoteType: "EQUITY",
      exchange: "NYQ",
    },
  ],
};

it("keeps stocks and ETFs listed on US exchanges, as catalog symbols", () => {
  expect(yahooListings(VOO_SEARCH)).toEqual([
    { symbol: "VOO.US", name: "Vanguard S&P 500 ETF", type: "etf" },
    {
      symbol: "VOOG.US",
      name: "Vanguard S&P 500 Growth Index Fund ETF Shares",
      type: "etf",
    },
    { symbol: "VOOB.US", name: "VistaShares Shield S&P 500 Enha", type: "etf" },
    { symbol: "BRK-B.US", name: "Berkshire Hathaway Inc.", type: "stock" },
  ]);
});

it("names a listing by its symbol when Yahoo gives no name", () => {
  expect(
    yahooListings({
      quotes: [{ symbol: "XYZ", quoteType: "EQUITY", exchange: "NMS" }],
    }),
  ).toEqual([{ symbol: "XYZ.US", name: "XYZ.US", type: "stock" }]);
});

it("refuses an answer of another shape", () => {
  expect(() => yahooListings({ finance: { error: "x" } })).toThrow("bad_shape");
});

it("asks for the query as typed, escaped", () => {
  expect(searchUrl("BRK B")).toContain("?q=BRK%20B&");
});
