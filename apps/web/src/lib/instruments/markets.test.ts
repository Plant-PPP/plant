import { marketsFor } from "./markets";

it.each([
  ["IOL", ["byma"]],
  ["InvertirOnline", ["byma"]],
  ["Cocos Capital", ["byma"]],
  ["Binance", ["crypto"]],
  ["Ripio Trade", ["crypto"]],
  ["Interactive Brokers", ["byma", "crypto"]],
  ["", ["byma", "crypto"]],
  [undefined, ["byma", "crypto"]],
])("searches %j's instruments in %j", (institution, markets) => {
  expect(marketsFor(institution)).toEqual(markets);
});
