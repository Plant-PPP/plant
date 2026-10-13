"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// The terms a user accepts before their first file: what Plant does with it
// and what it never does.
export function ConsentCard({ onAccept }: { onAccept: () => void }) {
  const id = useId();
  const [checked, setChecked] = useState(false);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid gap-3 rounded-lg border p-4"
    >
      <h2 id={`${id}-title`} className="text-base font-semibold">
        Antes de tu primer archivo
      </h2>
      <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
        <li>
          Leemos tu resumen para armar tus tenencias; vos lo revisás antes de
          guardarlo.
        </li>
        <li>Guardamos el archivo 30 días y después lo borramos.</li>
        <li>Ignoramos tu DNI, CUIT y CBU, y nunca los guardamos.</li>
        <li>Plant solo muestra: nunca compra, vende ni mueve tu plata.</li>
      </ul>
      <div className="flex items-start gap-2">
        <input
          id={`${id}-check`}
          type="checkbox"
          className="accent-primary mt-0.5 size-4 shrink-0"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <Label htmlFor={`${id}-check`} className="text-sm leading-snug">
          Leí y acepto los términos y la política de privacidad.
        </Label>
      </div>
      <div>
        <Button type="button" size="sm" disabled={!checked} onClick={onAccept}>
          Aceptar y seguir
        </Button>
      </div>
    </section>
  );
}
