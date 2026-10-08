jest.mock("server-only", () => ({}), { virtual: true });

import { createServiceRoleClient } from "./service-role";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "secret",
};

afterEach(() => {
  for (const name of Object.keys(ENV)) delete process.env[name];
});

it("sends the secret key and starts no refresh timer", async () => {
  Object.assign(process.env, ENV);
  jest.useFakeTimers();
  const fetch = jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 201 }));
  try {
    const client = createServiceRoleClient();
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
    await client!.from("ai_costs").insert({} as never);
    const headers = new Headers(
      (fetch.mock.calls[0]?.[1] as RequestInit).headers,
    );
    expect(headers.get("apikey")).toBe("secret");
    expect(headers.get("authorization")).toBe("Bearer secret");
  } finally {
    fetch.mockRestore();
    jest.useRealTimers();
  }
});

it.each(Object.keys(ENV))("returns null without %s", (missing) => {
  Object.assign(process.env, ENV);
  delete process.env[missing];
  expect(createServiceRoleClient()).toBeNull();
});
