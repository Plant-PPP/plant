"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// Deleting the account and everything in it, after asking.
export function DeleteAccountCard({ onDelete }: { onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <Card className="max-w-3xl gap-0">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">Borrar tu cuenta</CardTitle>
        <CardDescription>
          Borra tus cuentas, tenencias, movimientos, deudas, cargas y consultas,
          y los archivos que subiste. Si querés guardar algo, bajá tus datos
          antes.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <Button
          ref={button}
          type="button"
          variant="destructive"
          onClick={() => setAsking(true)}
        >
          Borrar mi cuenta
        </Button>
      </CardContent>
      {asking && (
        <ConfirmDialog
          title="¿Borrar tu cuenta?"
          description="Se borra todo lo que cargaste en Plant. No se puede deshacer."
          confirmLabel="Borrar mi cuenta"
          returnFocusTo={() => button.current}
          onClose={() => setAsking(false)}
          onConfirm={onDelete}
        />
      )}
    </Card>
  );
}
