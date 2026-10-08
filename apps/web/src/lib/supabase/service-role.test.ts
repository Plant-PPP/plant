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

it("builds a client when the URL, anon key and secret key are set", () => {
  Object.assign(process.env, ENV);
  expect(createServiceRoleClient()).not.toBeNull();
});

it.each(Object.keys(ENV))("returns null without %s", (missing) => {
  Object.assign(process.env, ENV);
  delete process.env[missing];
  expect(createServiceRoleClient()).toBeNull();
});
