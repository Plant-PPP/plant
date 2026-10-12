import {
  deleteAccountDescription,
  deleteMessages,
  WRITE_MESSAGES,
} from "./messages";

it("says an account's uploads go with it and still count this month", () => {
  expect(deleteAccountDescription(true)).toBe(
    "Las cargas de esta cuenta se borran y siguen contando para este mes. No se puede deshacer.",
  );
  expect(deleteAccountDescription(false)).toBe("No se puede deshacer.");
});

describe("deleteMessages", () => {
  it("asks for a delete or a move where an archive's refusal asks for an archive", () => {
    for (const table of ["portfolios", "source_connections"] as const) {
      const messages = deleteMessages(WRITE_MESSAGES[table]);
      for (const hint of [
        "portfolio_in_use",
        "portfolio_has_holdings",
        "source_connection_has_holdings",
      ] as const) {
        expect(messages[hint]).toMatch(/^Para borrar/);
      }
    }
  });
});
