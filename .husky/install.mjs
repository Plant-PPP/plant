// Production and CI installs skip devDependencies, so the husky binary may be
// absent there (Vercel prunes them and then runs the root prepare): bail out
// instead of failing the whole install.
if (process.env.NODE_ENV === "production" || process.env.CI === "true" || process.env.CI === "1") {
  process.exit(0);
}
const husky = (await import("husky")).default;
console.log(husky());
