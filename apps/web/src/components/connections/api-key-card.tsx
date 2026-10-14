"use client";

import type { ConnectionDraft } from "@plant/sources";
import { KeyRound, ListOrdered, RefreshCw } from "lucide-react";
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
  type ConnectionForm,
  SYNC_MESSAGES,
} from "@/lib/connections/api-key";
import { formatDate } from "@/lib/format/date";

// An account's connection by API with its broker or exchange: connect its
// credentials, sync its holdings (or its operations, where the provider
// gives them) into an import to review in Cargar, or disconnect. The
// credentials leave the browser once, to be kept in Vault; the page only
// ever shows the last characters of the field they are named by.
export function ApiKeyCard({
  accountId,
  form,
  apiKey,
  actions,
}: {
  accountId: string;
  form: ConnectionForm;
  apiKey: ApiKeyView | null;
  actions: ApiKeyActions;
}) {
  const headingId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null);
  const [synced, setSynced] = useState<ConnectionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sync = (draft: ConnectionDraft) =>
    startTransition(async () => {
      setError(null);
      setSynced(null);
      const result = await actions.sync(accountId, draft);
      if (result.ok) setSynced(draft);
      else setError(SYNC_MESSAGES[result.code]);
    });

  const disconnect = () =>
    startTransition(async () => {
      setError(null);
      setSynced(null);
      const result = await actions.disconnect(accountId);
      if (!result.ok) setError("No pudimos desconectar la cuenta.");
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
            Conexión con {form.name}
          </h2>
          <p className="text-muted-foreground text-sm">
            {apiKey
              ? `${form.hint}: …${apiKey.keyHint} · conectada el ${formatDate(apiKey.connectedOn)}. Plant solo lee: nunca opera ni retira.`
              : `Conectá tu cuenta de ${form.name} para traer tus tenencias sin subir archivos. Plant solo lee: nunca opera ni retira.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {apiKey ? (
            <>
              <PendingButton
                type="button"
                size="sm"
                pending={pending}
                onClick={() => sync("holdings")}
              >
                <RefreshCw aria-hidden />
                Sincronizar
              </PendingButton>
              {form.drafts.includes("operations") && (
                <PendingButton
                  type="button"
                  size="sm"
                  variant="outline"
                  pending={pending}
                  onClick={() => sync("operations")}
                >
                  <ListOrdered aria-hidden />
                  Traer operaciones
                </PendingButton>
              )}
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
              Conectar {form.name}
            </Button>
          )}
        </div>
      </div>
      {synced && (
        <p role="status" className="text-sm">
          {synced === "operations"
            ? "Estamos leyendo tus operaciones."
            : "Estamos leyendo tus tenencias."}{" "}
          Cuando estén, revisalas y confirmalas en{" "}
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
          form={form}
          connect={actions.connect}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "disconnect" && (
        <ConfirmDialog
          title={`Desconectar ${form.name}`}
          description={`Borramos de Plant los datos de acceso. Lo que ya confirmaste queda en la cuenta. Para dejar de usarlos del todo, revocalos también en ${form.name}.`}
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
  form,
  connect,
  onClose,
}: {
  accountId: string;
  form: ConnectionForm;
  connect: ApiKeyActions["connect"];
  onClose: () => void;
}) {
  const id = useId();
  const alertId = `${id}-alert`;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const described = error ? alertId : undefined;

  return (
    <AppDialog
      onClose={onClose}
      title={`Conectar ${form.name}`}
      description={form.help}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const credentials = Object.fromEntries(
            form.fields.map((field) => {
              const value = String(data.get(field.name) ?? "");
              // A password is taken as typed; a key or an id without the
              // spaces a copy and paste adds.
              return [
                field.name,
                field.name === "password" ? value : value.trim(),
              ];
            }),
          );
          const confirmedReadOnly = data.get("confirmedReadOnly") === "on";
          startTransition(async () => {
            setError(null);
            const result = await connect({
              accountId,
              provider: form.provider,
              credentials,
              confirmedReadOnly,
            });
            if (result.ok) onClose();
            else setError(CONNECT_MESSAGES[result.code]);
          });
        }}
      >
        {form.fields.map((field) => (
          <div key={field.name} className="grid gap-2">
            <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
            <Input
              id={`${id}-${field.name}`}
              name={field.name}
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={described}
            />
          </div>
        ))}
        {form.confirm && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="confirmedReadOnly"
              required
              className="mt-0.5 size-4"
            />
            <span>{form.confirm}</span>
          </label>
        )}
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
