import { connectionForm, providerOf } from "@/lib/connections/api-key";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  addSync,
  connectApiKey,
  disconnectApiKey,
  finishSync,
} from "./prototype-api-keys-store";
import { confirmImport } from "./prototype-imports-store";
import { initialState } from "./prototype-store";

const TODAY = "2026-10-14";
const state = initialState(buildFixtures(TODAY), TODAY);
const BINANCE = state.accounts.find((row) => row.institution === "Binance")!;
const IOL = state.accounts.find((row) => row.institution === "IOL")!;
// Made up.
const INPUT = {
  accountId: BINANCE.id,
  provider: "binance" as const,
  credentials: {
    apiKey: "MadeUpApiKey00000000WXYZ",
    apiSecret: "MadeUpSecret0000000000001",
  },
  confirmedReadOnly: false,
};

const connected = connectApiKey(state, INPUT).state;

it("offers a connection on the accounts of a provider only", () => {
  expect(providerOf(BINANCE.institution)).toBe("binance");
  expect(providerOf(IOL.institution)).toBe("iol");
  expect(providerOf("Balanz")).toBeNull();
});

it("keeps the key's last four characters and nothing of the secret", () => {
  expect(connected.apiKeys.get(BINANCE.id)).toEqual({
    provider: "binance",
    keyHint: "WXYZ",
    connectedOn: TODAY,
  });
  expect(JSON.stringify([...connected.apiKeys])).not.toContain("MadeUpSecret");
});

it("refuses a key that can trade, one that does not parse, and another provider's", () => {
  expect(
    connectApiKey(state, {
      ...INPUT,
      credentials: { ...INPUT.credentials, apiKey: "TradeKey0000000000001" },
    }).result,
  ).toEqual({ ok: false, code: "not_read_only" });
  expect(
    connectApiKey(state, {
      ...INPUT,
      credentials: { ...INPUT.credentials, apiSecret: "x" },
    }).result,
  ).toEqual({ ok: false, code: "invalid" });
  expect(connectApiKey(state, { ...INPUT, accountId: IOL.id }).result).toEqual({
    ok: false,
    code: "unsupported",
  });
});

it("asks IOL's user to confirm it only reads", () => {
  const input = {
    accountId: IOL.id,
    provider: "iol" as const,
    credentials: { username: "ana.test", password: "MadeUp!1" },
    confirmedReadOnly: false,
  };
  expect(connectionForm("iol").confirm).not.toBeNull();
  expect(connectApiKey(state, input).result).toEqual({
    ok: false,
    code: "unconfirmed",
  });
  expect(
    connectApiKey(state, {
      ...input,
      confirmedReadOnly: true,
    }).state.apiKeys.get(IOL.id),
  ).toMatchObject({ provider: "iol", keyHint: "test" });
});

it("syncs into an import to review, one at a time, counting no upload", () => {
  expect(addSync(state, { id: "s0", accountId: BINANCE.id }).result).toEqual({
    ok: false,
    code: "not_connected",
  });
  const queued = addSync(connected, { id: "s1", accountId: BINANCE.id });
  expect(queued.result).toEqual({ ok: true, importId: "s1" });
  expect(queued.state.uploadedOn).toEqual(connected.uploadedOn);
  expect(
    addSync(queued.state, { id: "s2", accountId: BINANCE.id }).result,
  ).toEqual({ ok: false, code: "in_progress" });

  const ready = finishSync(queued.state, "s1");
  const item = ready.imports.find((each) => each.id === "s1")!;
  expect(item).toMatchObject({
    status: "ready",
    fileName: "Sincronización con Binance",
    documentDate: TODAY,
  });
  expect(item.rows.map((row) => [row.symbol, row.quantity])).toEqual([
    ["BTC", "0.0125"],
    ["ETH", "0.85"],
    ["SOL", "12.4"],
  ]);
  expect(
    confirmImport(ready, "s1", item.rows, () => crypto.randomUUID()).result,
  ).toMatchObject({ ok: true });
});

it("disconnects the key", () => {
  const removed = disconnectApiKey(connected, BINANCE.id);
  expect(removed.result).toEqual({ ok: true });
  expect(removed.state.apiKeys.has(BINANCE.id)).toBe(false);
});
