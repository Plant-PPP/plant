// Whether this is the production deployment, where the prototype is not
// served. Previews and `next dev` are not production.
export const isProductionDeployment = (): boolean =>
  process.env.VERCEL_ENV === "production";
