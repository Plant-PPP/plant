/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: ".*\\.test\\.tsx?$",
  moduleNameMapper: {
    "\\.png$": "<rootDir>/src/test/static-image.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
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
