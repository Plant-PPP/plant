import { Constants } from "@plant/shared";

import {
  INSTRUMENT_TYPES,
  PENDING_INSTRUMENT_TYPES,
  quotedPrice,
  unitPrice,
} from "./instruments";

it("keeps the pending types apart from the database's", () => {
  const stored: readonly string[] = Constants.public.Enums.instrument_type;
  for (const type of PENDING_INSTRUMENT_TYPES) {
    expect(stored).not.toContain(type);
  }
  expect(new Set(INSTRUMENT_TYPES).size).toBe(INSTRUMENT_TYPES.length);
});

it("prices a bond per 100 nominal and anything else per unit", () => {
  expect(unitPrice("bond", "85")).toBe("0.85");
  expect(quotedPrice("bond", "0.85")).toBe("85");
  expect(unitPrice("cedear", "18650")).toBe("18650");
  expect(quotedPrice("crypto", "65123.45")).toBe("65123.45");
});

it("rounds a unit price to 8 decimals", () => {
  expect(unitPrice("bond", "0.00000123")).toBe("0.00000001");
});
