// Whether this is the production deployment, where dev aids and the prototype
// are not served. Previews and `next dev` are not production.
export const isProductionDeployment = (): boolean =>
  process.env.VERCEL_ENV === "production";
