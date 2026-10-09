import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import { rowAnswer, sheetAnswer } from "./answers";

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

  test.each([
    [[], "Esa cartera es la de una cuenta activa."],
    [["IOL"], "Esa cartera es la de una cuenta activa: IOL."],
    [["IOL", "Balanz"], "Esa cartera es la de cuentas activas: IOL y Balanz."],
    [
      ["IOL", "Balanz", "Cocos"],
      "Esa cartera es la de cuentas activas: IOL, Balanz y Cocos.",
    ],
  ])("a portfolio in use by %j says so", (usedBy, text) => {
    expect(
      rowAnswer(
        { ok: false, code: "portfolio_in_use" },
        "archive",
        PORTFOLIOS,
        usedBy,
      ),
    ).toEqual({ kind: "alert", text });
  });

  test("a holder in use names its accounts", () => {
    expect(
      rowAnswer(
        { ok: false, code: "holder_in_use" },
        "archive",
        WRITE_MESSAGES.holders,
        ["IOL"],
      ),
    ).toEqual({
      kind: "alert",
      text: "Ese titular es el de una cuenta activa: IOL.",
    });
  });
});

describe("sheetAnswer", () => {
  test("closes on success and keeps the copy otherwise", () => {
    expect(sheetAnswer({ ok: true, id: ID }, PORTFOLIOS)).toEqual({
      kind: "done",
    });
    expect(
      sheetAnswer({ ok: false, code: "duplicate_name" }, PORTFOLIOS),
    ).toEqual({
      kind: "alert",
      text: "Ya tenés una cartera con ese nombre.",
    });
    expect(sheetAnswer("rejected", PORTFOLIOS)).toEqual({
      kind: "alert",
      text: PORTFOLIOS.failed,
    });
  });

  test("uses the copy of the table it wrote", () => {
    expect(
      sheetAnswer(
        { ok: false, code: "duplicate_name" },
        WRITE_MESSAGES.holders,
      ),
    ).toEqual({ kind: "alert", text: "Ya tenés un titular con ese nombre." });
    expect(
      sheetAnswer(
        { ok: false, code: "holder_archived" },
        WRITE_MESSAGES.source_connections,
      ),
    ).toEqual({ kind: "alert", text: "Ese titular está archivado." });
  });
});
