import { isProductionDeployment } from "./deployment";

const saved = {
  env: process.env.VERCEL_ENV,
  ref: process.env.VERCEL_GIT_COMMIT_REF,
};
afterEach(() => {
  for (const [key, value] of [
    ["VERCEL_ENV", saved.env],
    ["VERCEL_GIT_COMMIT_REF", saved.ref],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

it.each([
  ["production", "production", true],
  ["preview", "staging", true],
  ["preview", "feat/pla-1-x", false],
  ["development", "staging", false],
  [undefined, undefined, false],
])("VERCEL_ENV=%s on %s serves the real app: %s", (env, ref, real) => {
  if (env === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = env;
  if (ref === undefined) delete process.env.VERCEL_GIT_COMMIT_REF;
  else process.env.VERCEL_GIT_COMMIT_REF = ref;
  expect(isProductionDeployment()).toBe(real);
});
