import { buildFixtures } from "@/lib/prototype/fixtures";
import { CONSENT_VERSION } from "@/lib/consent";

import { acceptConsent, freshState, initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);

it("has the made-up user's terms accepted, and a new user's not", () => {
  expect(state.consent).toEqual({
    version: CONSENT_VERSION,
    acceptedOn: TODAY,
  });
  expect(freshState(state, "p-new").consent).toBeNull();
});

it("records the version accepted and the day", () => {
  const fresh = freshState(state, "p-new");
  expect(acceptConsent(fresh, CONSENT_VERSION).state.consent).toEqual({
    version: CONSENT_VERSION,
    acceptedOn: TODAY,
  });
});
