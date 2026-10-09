import packages from "../../eslint.packages.mjs";

// A quote's day and hour are Buenos Aires', from @plant/shared's time
// helpers; these accessors read the host's zone instead.
const HOST_ZONE_ACCESSORS = [
  "getDay",
  "getDate",
  "getHours",
  "getMonth",
  "getFullYear",
  "setDate",
  "setHours",
];

export default [
  ...packages,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...HOST_ZONE_ACCESSORS.map((property) => ({
          property,
          message:
            "Reads the host's time zone; use buenosAiresDate/buenosAiresHour or the getUTC* accessors.",
        })),
      ],
    },
  },
];
