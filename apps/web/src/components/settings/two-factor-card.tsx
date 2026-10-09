"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DisableTotpDialog } from "@/components/mfa/disable-totp-dialog";
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
import { SETTINGS_ITEM } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  canDisable,
  confirmsDisable,
  fetchTwoFactorState,
  twoFactorSwitch,
  type TwoFactorPanel,
  type TwoFactorState,
  type TwoFactorStatus,
} from "./two-factor-status";

const DESCRIPTIONS: Record<TwoFactorStatus, string> = {
  loading: "Cargando…",
  failed: "No pudimos cargar el estado.",
  on: "Tu cuenta está protegida con una app de autenticación.",
  off: "Al activarla, te pedimos un código de tu app al ingresar.",
};

const fetchState = () => fetchTwoFactorState(createClient());

// ?confirm=disable opens the off dialog once TOTP shows on: the step-up's
// sign-in comes back here with it. It is read from the URL on mount, not from
// the server's render, which back and forward reuse after the URL is cleared.
export function TwoFactorCard({ stepUpNeeded }: { stepUpNeeded: boolean }) {
  const searchParams = useSearchParams();
  const [confirmDisable] = useState(() => confirmsDisable(searchParams));
  const [state, setState] = useState<TwoFactorState>({ status: "loading" });
  const [panel, setPanel] = useState<TwoFactorPanel>("none");
  const [notice, setNotice] = useState<string>();
  // Once the action asks for the step-up, every later try starts there.
  const [stepUp, setStepUp] = useState(stepUpNeeded);

  useEffect(() => {
    let active = true;
    void fetchState().then((next) => {
      if (!active) return;
      setState(next);
      if (confirmDisable && canDisable(next)) {
        setPanel("disable");
        // Once: a reload or a later sign-in back to this URL does not reopen it.
        window.history.replaceState(null, "", SETTINGS_ITEM.href);
      }
    });
    return () => {
      active = false;
    };
  }, [confirmDisable]);

  function reload() {
    setState({ status: "loading" });
    void fetchState().then(setState);
  }

  function closePanel(notice: string) {
    setPanel("none");
    setNotice(notice);
    reload();
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
              {DESCRIPTIONS[state.status]}
            </span>
          </div>
          <Switch
            id="two-factor"
            {...twoFactorSwitch(state, panel)}
            onCheckedChange={(checked) => {
              setNotice(undefined);
              setPanel(checked ? "enroll" : "disable");
            }}
          />
        </div>
        {state.status === "failed" && (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
            </Button>
          </div>
        )}
        {panel === "enroll" && (
          <TotpEnrollPanel
            onSuccess={() =>
              closePanel(
                "Activaste la verificación en dos pasos. Cerramos tus otras sesiones.",
              )
            }
            onAlreadyOn={() =>
              closePanel("La verificación en dos pasos ya estaba activada.")
            }
            onCancel={() => setPanel("none")}
          />
        )}
        {panel === "disable" && canDisable(state) && (
          <DisableTotpDialog
            open
            onOpenChange={(open) => !open && setPanel("none")}
            factorId={state.totpId}
            stepUp={stepUp}
            onStepUp={() => setStepUp(true)}
            onDone={closePanel}
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
