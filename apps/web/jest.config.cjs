/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: ".*\\.test\\.tsx?$",
  moduleNameMapper: {
    "\\.(png|svg)$": "<rootDir>/src/test/static-image.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^use-stick-to-bottom$": "<rootDir>/src/test/stick-to-bottom.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          isolatedModules: true,
          module: "commonjs",
          jsx: "react-jsx",
        },
      },
    ],
  },
};
