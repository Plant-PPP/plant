import { deleteMessages, WRITE_MESSAGES } from "./messages";

describe("deleteMessages", () => {
  it("asks for a delete or a move where an archive's refusal asks for an archive", () => {
    for (const table of [
      "portfolios",
      "holders",
      "source_connections",
    ] as const) {
      const messages = deleteMessages(WRITE_MESSAGES[table]);
      for (const hint of [
        "portfolio_in_use",
        "holder_in_use",
        "portfolio_has_holdings",
        "source_connection_has_holdings",
      ] as const) {
        expect(messages[hint]).toMatch(/^Para borrar/);
      }
    }
  });
});
