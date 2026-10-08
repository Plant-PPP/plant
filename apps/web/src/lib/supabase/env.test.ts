import { supabaseOrigins } from "./env";

it.each([
  ["https://x.supabase.co", ["https://x.supabase.co", "wss://x.supabase.co"]],
  [
    "http://127.0.0.1:54321",
    ["http://127.0.0.1:54321", "ws://127.0.0.1:54321"],
  ],
  [
    "https://x.supabase.co/rest/v1/",
    ["https://x.supabase.co", "wss://x.supabase.co"],
  ],
])("%s reaches %p", (url, origins) => {
  expect(supabaseOrigins(url)).toEqual(origins);
});
