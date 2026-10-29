"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { refreshPrices } from "@/app/(app)/quotes-actions";
import { BrandLogo } from "@/components/layout/brand-logo";
import { cn } from "@/lib/utils";

// The mark updates every price: it asks for the quotes job and spins until
// the request is in. Before the close hour the prices shown are already the
// last close, and the day's comes with the evening runs.
export function AppSidebarLogoLink() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="group"
      aria-label="Actualizar precios"
      title="Actualizar precios"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await refreshPrices();
          if (!result.ok) toast.error("No pudimos actualizar los precios.");
          else if (result.beforeClose) {
            toast.info(
              "Ya tenés el último cierre. El de hoy llega desde las 18 hs.",
            );
          } else {
            toast.success("Actualizando precios. En unos minutos se ven.");
            router.refresh();
          }
        })
      }
    >
      <BrandLogo
        variant="mark"
        className={cn(
          "size-6 transition-transform duration-500 ease-in-out group-hover:rotate-120",
          pending && "animate-spin",
        )}
      />
    </button>
  );
}
