// Whether this deployment serves the real app rather than the prototype:
// production, and staging, the one preview Tomas tests on its real data
// (`plant-staging` until the beta). Every other preview and `next dev` serve
// the prototype; `pnpm dev:up:real` runs the real app locally.
export const isProductionDeployment = (): boolean =>
  process.env.VERCEL_ENV === "production" ||
  (process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "staging");
