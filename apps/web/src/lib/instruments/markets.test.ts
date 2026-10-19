import { marketsFor } from "./markets";

it.each([
  ["IOL", ["byma"]],
  ["InvertirOnline", ["byma"]],
  ["Cocos Capital", ["byma"]],
  ["Binance", ["crypto"]],
  ["Ripio Trade", ["crypto"]],
  ["Interactive Brokers", ["us", "crypto"]],
  ["IBKR", ["us", "crypto"]],
  ["Wallbit", ["us", "crypto"]],
  ["", ["byma", "us", "crypto"]],
  [undefined, ["byma", "us", "crypto"]],
])("searches %j's instruments in %j", (institution, markets) => {
  expect(marketsFor(institution)).toEqual(markets);
});
