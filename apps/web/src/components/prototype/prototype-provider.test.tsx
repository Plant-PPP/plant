import { renderToStaticMarkup } from "react-dom/server";

import { assetKey } from "@/lib/holdings/assets-rows";
import { buildFixtures } from "@/lib/prototype/fixtures";

import { PrototypeProvider, usePrototype } from "./prototype-provider";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);

// The details the pages read, as the provider hands them out.
function detailsOf() {
  let seen: ReturnType<typeof usePrototype>["details"] | undefined;
  function Probe() {
    seen = usePrototype().details;
    return null;
  }
  renderToStaticMarkup(
    <PrototypeProvider
      today={TODAY}
      snapshot={{ date: TODAY, prices: {}, fx: {} }}
    >
      <Probe />
    </PrototypeProvider>,
  );
  return seen!;
}

describe("the details every page reads", () => {
  it("counts every asset in the report until the user leaves one out", () => {
    const details = detailsOf();
    for (const row of fixtures.holdings) {
      expect(details.inTaxReport(assetKey(row.holding))).toBe(true);
    }
  });

  it("gives each holding its stored origin, and none for one there is not", () => {
    const details = detailsOf();
    const [first] = fixtures.holdings;
    expect(details.originOf(first!.id)).toEqual({ kind: "manual" });
    expect(details.originOf("not-a-holding")).toBeUndefined();
  });
});
