// Neither UTC, where CI and Vercel run, nor Buenos Aires: a helper that reads
// local time instead of BUENOS_AIRES_TZ fails here.
process.env.TZ = "Asia/Tokyo";

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: ".*\\.test\\.ts$",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: { isolatedModules: true, module: "commonjs" } },
    ],
  },
};
