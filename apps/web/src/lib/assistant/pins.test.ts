jest.mock("server-only", () => ({}), { virtual: true });

import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { pinChart } from "./pins";

// A client whose insert into pinned_charts answers `answer`.
function client(answer: { error: unknown; status: number }) {
  return {
    from: () => ({ insert: async () => answer }),
  } as unknown as SupabaseClient<Database>;
}

const source = { topic: "net_worth", portfolioId: null } as const;

it("pins a chart", async () => {
  expect(await pinChart(client({ error: null, status: 201 }), source)).toBe(
    "pinned",
  );
});

it("answers already for a chart pinned before", async () => {
  const answer = { error: { code: "23505" }, status: 409 };
  expect(await pinChart(client(answer), source)).toBe("already");
});

it("answers full when the database finds the user's pins at the limit", async () => {
  const answer = {
    error: { code: "P0001", hint: "pinned_charts_full" },
    status: 400,
  };
  expect(await pinChart(client(answer), source)).toBe("full");
});

it("answers failed for any other refusal", async () => {
  const answer = { error: { code: "P0001", hint: null }, status: 400 };
  expect(await pinChart(client(answer), source)).toBe("failed");
});
