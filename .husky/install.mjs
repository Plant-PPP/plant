// Production and CI installs skip devDependencies, so the husky binary may be
// absent there — bail out instead of failing the whole install (this killed
// Vercel builds, which prune devDependencies and then run the root prepare).
if (process.env.NODE_ENV === "production" || process.env.CI === "true" || process.env.CI === "1") {
  process.exit(0);
}
const husky = (await import("husky")).default;
console.log(husky());
