"use client";

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function AppLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4 hover:text-foreground"
    >
      {children}
    </a>
  );
}

export function TotpHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿No podés activar la verificación?</DialogTitle>
          <DialogDescription>
            Necesitás una app de autenticación en el celular o en tu gestor de
            contraseñas. Escaneá el QR o pegá la clave de configuración, y
            después ingresá el código de 6 dígitos que muestra la app.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm">
          <section className="grid gap-1.5">
            <h3 className="font-medium">Qué app usar</h3>
            <p className="text-muted-foreground">
              Sirven{" "}
              <AppLink href="https://support.google.com/accounts/answer/1066447">
                Google Authenticator
              </AppLink>
              {", "}
              <AppLink href="https://www.microsoft.com/es-ar/security/mobile-authenticator-app">
                Microsoft Authenticator
              </AppLink>
              {" o "}
              <AppLink href="https://1password.com/">1Password</AppLink>.
            </p>
          </section>
          <section className="grid gap-1.5">
            <h3 className="flex items-center gap-1.5 font-medium">
              <TriangleAlert
                className="size-3.5 shrink-0 text-amber-500"
                aria-hidden
              />
              Microsoft Authenticator
            </h3>
            <p className="text-muted-foreground">
              Tocá + y, cuando te pregunte qué tipo de cuenta agregás, elegí{" "}
              <span className="font-bold text-foreground">
                Otra cuenta (Google, Facebook, etc.)
              </span>
              . No elijas Personal ni Trabajo o escuela: si la app solo acepta
              números, volvé y elegí Otra cuenta (Google, Facebook, etc.).
            </p>
          </section>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
