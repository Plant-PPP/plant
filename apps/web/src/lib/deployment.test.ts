import { isProductionDeployment } from "./deployment";

const saved = process.env.VERCEL_ENV;
afterEach(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

it.each([
  ["production", true],
  ["preview", false],
  ["development", false],
  [undefined, false],
])("VERCEL_ENV=%s is production: %s", (env, production) => {
  if (env === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = env;
  expect(isProductionDeployment()).toBe(production);
});
