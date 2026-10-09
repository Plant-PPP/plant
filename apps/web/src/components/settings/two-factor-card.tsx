"use client";

import { useEffect, useState } from "react";
import { TotpEnrollPanel } from "@/components/mfa/totp-enroll-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import {
  fetchTwoFactorStatus,
  twoFactorSwitch,
  type TwoFactorStatus,
} from "./two-factor-status";

const DESCRIPTIONS: Record<TwoFactorStatus, string> = {
  loading: "Cargando…",
  failed: "No pudimos cargar el estado.",
  on: "Tu cuenta está protegida con una app de autenticación.",
  off: "Al activarla, te pedimos un código de tu app al ingresar.",
};

const fetchStatus = () => fetchTwoFactorStatus(createClient());

export function TwoFactorCard() {
  const [status, setStatus] = useState<TwoFactorStatus>("loading");
  const [enrolling, setEnrolling] = useState(false);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    void fetchStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  function reload() {
    setStatus("loading");
    void fetchStatus().then(setStatus);
  }

  return (
    <Card className="max-w-3xl gap-0">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">
          <h2>Seguridad</h2>
        </CardTitle>
        <CardDescription>Cómo protegés el ingreso a tu cuenta</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="two-factor">Verificación en dos pasos</Label>
            <span className="text-xs text-muted-foreground">
              {DESCRIPTIONS[status]}
            </span>
          </div>
          <Switch
            id="two-factor"
            {...twoFactorSwitch(status, enrolling)}
            onCheckedChange={(checked) => {
              if (!checked) return;
              setNotice(undefined);
              setEnrolling(true);
            }}
          />
        </div>
        {status === "failed" && (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          </div>
        )}
        {enrolling && (
          <TotpEnrollPanel
            onSuccess={() => {
              setEnrolling(false);
              setNotice(
                "Activaste la verificación en dos pasos. Cerramos tus otras sesiones que no la tenían.",
              );
              reload();
            }}
            onCancel={() => setEnrolling(false)}
          />
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
