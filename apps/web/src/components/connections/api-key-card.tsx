"use client";

import { KeyRound, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PendingButton } from "@/components/ui/pending-button";
import {
  type ApiKeyActions,
  type ApiKeyView,
  CONNECT_MESSAGES,
  EXCHANGE_NAMES,
  SYNC_MESSAGES,
} from "@/lib/connections/api-key";
import type { ExchangeProvider } from "@plant/sources";
import { formatDate } from "@/lib/format/date";

// An exchange account's connection by API: connect a read-only key, sync its
// balances into an import to review in Cargar, or disconnect the key. The
// key and its secret leave the browser once, to be sealed; the page only
// ever shows the key's last four characters.
export function ApiKeyCard({
  accountId,
  provider,
  apiKey,
  actions,
}: {
  accountId: string;
  provider: ExchangeProvider;
  apiKey: ApiKeyView | null;
  actions: ApiKeyActions;
}) {
  const headingId = useId();
  const name = EXCHANGE_NAMES[provider];
  const opener = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sync = () =>
    startTransition(async () => {
      setError(null);
      setSynced(false);
      const result = await actions.sync(accountId);
      if (result.ok) setSynced(true);
      else setError(SYNC_MESSAGES[result.code]);
    });

  const disconnect = () =>
    startTransition(async () => {
      setError(null);
      setSynced(false);
      const result = await actions.disconnect(accountId);
      if (!result.ok) setError("No pudimos desconectar la clave.");
    });

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2
            id={headingId}
            className="flex items-center gap-2 text-base font-semibold"
          >
            <KeyRound aria-hidden className="size-4" />
            Conexión con {name}
          </h2>
          <p className="text-muted-foreground text-sm">
            {apiKey
              ? `Clave terminada en ${apiKey.keyHint}, conectada el ${formatDate(apiKey.connectedOn)}. Plant solo lee tus saldos: nunca opera ni retira.`
              : `Conectá una clave de solo lectura de ${name} para traer tus saldos sin subir archivos. Plant nunca opera ni retira.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {apiKey ? (
            <>
              <PendingButton
                type="button"
                size="sm"
                pending={pending}
                onClick={sync}
              >
                <RefreshCw aria-hidden />
                Sincronizar
              </PendingButton>
              <Button
                ref={opener}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDialog("disconnect")}
              >
                Desconectar
              </Button>
            </>
          ) : (
            <Button
              ref={opener}
              type="button"
              size="sm"
              onClick={() => setDialog("connect")}
            >
              Conectar {name}
            </Button>
          )}
        </div>
      </div>
      {synced && (
        <p role="status" className="text-sm">
          Estamos leyendo tus saldos. Cuando estén, revisalos y confirmalos en{" "}
          <Link href="/import" className="underline underline-offset-4">
            Cargar
          </Link>
          .
        </p>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      {dialog === "connect" && (
        <ConnectDialog
          accountId={accountId}
          provider={provider}
          connect={actions.connect}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "disconnect" && (
        <ConfirmDialog
          title={`Desconectar ${name}`}
          description="Borramos la clave de Plant. Lo que ya confirmaste queda en la cuenta. Para dejar de usarla del todo, borrala también en el exchange."
          confirmLabel="Desconectar"
          returnFocusTo={() => opener.current}
          onClose={() => setDialog(null)}
          onConfirm={disconnect}
        />
      )}
    </section>
  );
}

function ConnectDialog({
  accountId,
  provider,
  connect,
  onClose,
}: {
  accountId: string;
  provider: ExchangeProvider;
  connect: ApiKeyActions["connect"];
  onClose: () => void;
}) {
  const name = EXCHANGE_NAMES[provider];
  const keyId = useId();
  const secretId = useId();
  const alertId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <AppDialog
      onClose={onClose}
      title={`Conectar ${name}`}
      description={`En ${name}, creá una clave de API con solo "Habilitar lectura". Si la clave puede operar, retirar o transferir, no la aceptamos.`}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const apiKey = String(form.get("apiKey") ?? "").trim();
          const apiSecret = String(form.get("apiSecret") ?? "").trim();
          startTransition(async () => {
            setError(null);
            const result = await connect({
              accountId,
              provider,
              apiKey,
              apiSecret,
            });
            if (result.ok) onClose();
            else setError(CONNECT_MESSAGES[result.code]);
          });
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor={keyId}>Clave de API</Label>
          <Input
            id={keyId}
            name="apiKey"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? alertId : undefined}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={secretId}>Clave secreta</Label>
          <Input
            id={secretId}
            name="apiSecret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? alertId : undefined}
          />
        </div>
        {error && <FormAlert id={alertId}>{error}</FormAlert>}
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <PendingButton type="submit" size="sm" pending={pending}>
            Conectar
          </PendingButton>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
