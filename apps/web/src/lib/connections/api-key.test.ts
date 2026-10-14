import { CONNECTION_PROVIDERS, connectionAdapters } from "@plant/sources";

import { connectionForm, keyHintOf, PROVIDERS, providerOf } from "./api-key";

describe("the provider registry", () => {
  it.each(CONNECTION_PROVIDERS)(
    "labels every field of the %s adapter, and asks a confirmation only where the provider does not tell",
    (provider) => {
      const adapter = connectionAdapters()[provider]();
      const form = connectionForm(provider);
      expect(form.fields.map((field) => field.name)).toEqual(
        adapter.fields.map((field) => field.name),
      );
      expect(Object.keys(PROVIDERS[provider].fields).sort()).toEqual(
        adapter.fields.map((field) => field.name).sort(),
      );
      const asks =
        adapter.readOnly === "confirmed" || adapter.readOnly === "none";
      expect(form.confirm !== null).toBe(asks);
      expect(form.hint).toBe(PROVIDERS[provider].fields[adapter.hintField]);
    },
  );

  it.each([
    ["Binance", "binance"],
    ["binance (spot)", "binance"],
    ["Wallbit", "wallbit"],
    ["Interactive Brokers", "ibkr"],
    ["IBKR", "ibkr"],
    ["Nexo", "nexo"],
    ["IOL", "iol"],
    ["InvertirOnline", "iol"],
    ["Roxom", "roxom"],
    ["Mercado Pago", "mercadopago"],
    ["MercadoPago", "mercadopago"],
    ["Bitso", "bitso"],
    ["Ripio Trade", "ripio"],
    ["Balanz", null],
    ["Cocos", null],
  ])("knows %s as %s", (institution, provider) => {
    expect(providerOf(institution)).toBe(provider);
  });

  it("shows the last four letters or digits of the field it is named by", () => {
    expect(keyHintOf("MadeUpKeyWXYZ")).toBe("WXYZ");
    expect(keyHintOf("ana.test")).toBe("test");
    expect(keyHintOf("a.b")).toBe("ab");
    expect(keyHintOf("...")).toBe("0");
  });
});
