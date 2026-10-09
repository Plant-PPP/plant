// Set here, before Jest starts its workers: an assignment inside a test only
// reaches Jest's copy of process.env. A zone west of UTC, where a date string
// read in the host's zone lands on the day before.
process.env.TZ = "America/Argentina/Buenos_Aires";

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
