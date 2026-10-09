import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import { rowAnswer, dialogAnswer } from "./answers";

const ID = "22222222-2222-4222-8222-222222222222";
const PORTFOLIOS = WRITE_MESSAGES.portfolios;

describe("rowAnswer", () => {
  test("a restore whose name is taken asks for another one", () => {
    expect(
      rowAnswer({ ok: false, code: "duplicate_name" }, "restore", PORTFOLIOS),
    ).toEqual({ kind: "ask_name" });
  });

  test("archiving the last portfolio shows its alert", () => {
    expect(
      rowAnswer(
        { ok: false, code: "last_active_portfolio" },
        "archive",
        PORTFOLIOS,
      ),
    ).toEqual({
      kind: "alert",
      text: "Necesitás al menos una cartera activa.",
    });
  });

  test("an archive never asks for a name", () => {
    expect(
      rowAnswer({ ok: false, code: "duplicate_name" }, "archive", PORTFOLIOS),
    ).toEqual({ kind: "alert", text: PORTFOLIOS.duplicate_name });
  });

  test("a rejected call shows the failed copy", () => {
    expect(rowAnswer("rejected", "restore", PORTFOLIOS)).toEqual({
      kind: "alert",
      text: PORTFOLIOS.failed,
    });
  });

  test("a success is done", () => {
    expect(rowAnswer({ ok: true, id: ID }, "archive", PORTFOLIOS)).toEqual({
      kind: "done",
    });
  });

  const inUse = (usedBy: string[]) =>
    rowAnswer(
      { ok: false, code: "portfolio_in_use" },
      "archive",
      PORTFOLIOS,
      usedBy,
    );

  test.each([
    [
      [],
      "Para archivar esta cartera, primero elegí otra en las cuentas que la usan o archivalas.",
    ],
    [
      ["tu IOL"],
      "Para archivar esta cartera, primero elegí otra o archivá esta cuenta: tu IOL.",
    ],
    [
      ["tu IOL", "Balanz de Lucía"],
      "Para archivar esta cartera, primero elegí otra o archivá estas cuentas: tu IOL, Balanz de Lucía.",
    ],
  ])("a portfolio in use by %j says so", (usedBy, text) => {
    expect(inUse(usedBy)).toEqual({ kind: "alert", text });
  });

  test("names each account once", () => {
    expect(inUse(["tu IOL", "tu IOL"])).toEqual({
      kind: "alert",
      text: "Para archivar esta cartera, primero elegí otra o archivá esta cuenta: tu IOL.",
    });
  });

  test("names the first three accounts and counts the rest", () => {
    expect(inUse(["tu A", "tu B", "tu C", "tu D", "tu E"])).toEqual({
      kind: "alert",
      text: "Para archivar esta cartera, primero elegí otra o archivá estas cuentas: tu A, tu B, tu C y 2 más.",
    });
  });

  test("a holder in use names its accounts", () => {
    expect(
      rowAnswer(
        { ok: false, code: "holder_in_use" },
        "archive",
        WRITE_MESSAGES.holders,
        ["IOL de Lucía"],
      ),
    ).toEqual({
      kind: "alert",
      text: "Para archivar este titular, primero elegí otro o archivá esta cuenta: IOL de Lucía.",
    });
  });
});

describe("dialogAnswer", () => {
  test("closes on success and keeps the copy otherwise", () => {
    expect(dialogAnswer({ ok: true, id: ID }, PORTFOLIOS)).toEqual({
      kind: "done",
    });
    expect(
      dialogAnswer({ ok: false, code: "duplicate_name" }, PORTFOLIOS),
    ).toEqual({
      kind: "alert",
      text: "Ya tenés una cartera con ese nombre.",
    });
    expect(dialogAnswer("rejected", PORTFOLIOS)).toEqual({
      kind: "alert",
      text: PORTFOLIOS.failed,
    });
  });

  test("uses the copy of the table it wrote", () => {
    expect(
      dialogAnswer(
        { ok: false, code: "duplicate_name" },
        WRITE_MESSAGES.holders,
      ),
    ).toEqual({ kind: "alert", text: "Ya tenés un titular con ese nombre." });
    expect(
      dialogAnswer(
        { ok: false, code: "holder_archived" },
        WRITE_MESSAGES.source_connections,
      ),
    ).toEqual({ kind: "alert", text: "Ese titular está archivado." });
  });
});
