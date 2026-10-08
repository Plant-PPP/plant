const createBrowserClient = jest.fn();
jest.mock("@supabase/ssr", () => ({ createBrowserClient }));

import { createClient } from "./client";

it("leaves refreshing the session to proxy.ts", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  createClient();
  expect(createBrowserClient).toHaveBeenCalledWith(
    "http://127.0.0.1:54321",
    "anon",
    expect.objectContaining({ auth: { autoRefreshToken: false } }),
  );
});
