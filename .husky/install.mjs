// Git hooks are for developer machines: CI and Vercel installs skip setting
// them up.
if (process.env.NODE_ENV === "production" || process.env.CI === "true" || process.env.CI === "1") {
  process.exit(0);
}
const husky = (await import("husky")).default;
console.log(husky());
