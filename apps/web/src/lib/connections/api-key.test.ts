import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONNECTION_PROVIDERS, connectionAdapters } from "@plant/sources";

import {
  type ConnectCode,
  connectionForm,
  connectMessages,
  keyHintOf,
  PROVIDERS,
  providerOf,
  SYNC_PERIOD_START,
} from "./api-key";

const MIGRATIONS = join(__dirname, "../../../../../supabase/migrations");

// The first day the newest migration that adds imports_sync_period allows.
function databasePeriodStart() {
  const sql = readdirSync(MIGRATIONS)
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
    .filter((text) => /ADD CONSTRAINT imports_sync_period\b/.test(text))
    .at(-1);
  return sql?.match(/sync_from BETWEEN '(\d{4}-\d{2}-\d{2})'/)?.[1];
}

test("SYNC_PERIOD_START matches the first day the database allows", () => {
  expect(databasePeriodStart()).toBe(SYNC_PERIOD_START);
});

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

it("names the provider when it refuses or does not answer", () => {
  const messages = connectMessages("Bitso");
  for (const message of Object.values(messages)) {
    expect(message).not.toMatch(/proveedor/i);
  }
  const named: ConnectCode[] = ["unsupported", "rejected", "unavailable"];
  for (const code of named) expect(messages[code]).toContain("Bitso");
});
