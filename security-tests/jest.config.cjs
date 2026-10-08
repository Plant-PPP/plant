/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: ".*\\.test\\.ts$",
  testTimeout: 30000,
  globalSetup: "<rootDir>/src/global-setup.ts",
  globalTeardown: "<rootDir>/src/global-teardown.ts",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: { isolatedModules: true, module: "commonjs" } },
    ],
  },
};
