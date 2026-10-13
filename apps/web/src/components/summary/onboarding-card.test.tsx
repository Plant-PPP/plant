import { renderToStaticMarkup } from "react-dom/server";

import { CONSENT_VERSION, onboardingSteps } from "@/lib/onboarding/steps";

import { OnboardingCard } from "./onboarding-card";

it("counts the steps left and links each one still to do", () => {
  const html = renderToStaticMarkup(
    <OnboardingCard
      steps={onboardingSteps({
        consentVersion: CONSENT_VERSION,
        accounts: 0,
        holdings: 0,
        questions: 0,
      })}
    />,
  );
  expect(html).toContain("Te faltan 3 pasos para ver tu patrimonio.");
  expect(html).toContain("(listo)");
  expect(html).toContain('href="/accounts"');
  expect(html).toContain('href="/assistant"');
  expect(html).not.toContain(">Ir a Cargar<");
});
