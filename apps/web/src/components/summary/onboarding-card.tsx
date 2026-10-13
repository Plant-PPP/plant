import { Check, Circle } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { countOf } from "@/lib/format/text";
import type { OnboardingStep } from "@/lib/onboarding/steps";
import { cn } from "@/lib/utils";

// A new user's way to their net worth: each step, done or with the link that
// does it, and how many are left.
export function OnboardingCard({
  steps,
}: {
  steps: readonly OnboardingStep[];
}) {
  const id = useId();
  const left = steps.filter((step) => !step.done).length;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-muted/40 grid gap-3 rounded-lg border p-4"
    >
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          Empecemos
        </h2>
        <p className="text-muted-foreground text-sm">
          {`Te ${left === 1 ? "falta" : "faltan"} ${countOf(left, "paso", "pasos")} para ver tu patrimonio.`}
        </p>
      </div>
      <ol className="grid gap-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span
              className={cn(
                "flex items-center gap-2",
                step.done && "text-muted-foreground line-through",
              )}
            >
              {step.done ? (
                <Check aria-hidden className="text-primary size-4 shrink-0" />
              ) : (
                <Circle aria-hidden className="size-4 shrink-0" />
              )}
              <span>
                {step.title}
                {step.done && <span className="sr-only"> (listo)</span>}
              </span>
            </span>
            {!step.done && (
              <Link
                href={step.href}
                className="font-medium underline-offset-2 hover:underline"
              >
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
