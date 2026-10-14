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
  type ConnectionForm,
  type ConnectResult,
  connectMessages,
  type DisconnectResult,
  SYNC_MESSAGES,
  type SyncResult,
} from "@/lib/connections/api-key";
import { formatDate } from "@/lib/format/date";
import { settle } from "@/lib/server-action-call";

export const DISCONNECT_FAILED = "No pudimos desconectar la cuenta.";

// What the card says when a call is refused or does not reach the server;
// null when it went through.
export async function syncFailure(call: Promise<SyncResult>) {
  const result = await settle(call);
  if (result === "rejected") return SYNC_MESSAGES.failed;
  return result.ok ? null : SYNC_MESSAGES[result.code];
}

export async function disconnectFailure(call: Promise<DisconnectResult>) {
  const result = await settle(call);
  return result !== "rejected" && result.ok ? null : DISCONNECT_FAILED;
}

export async function connectFailure(
  call: Promise<ConnectResult>,
  name: string,
) {
  const result = await settle(call);
  const messages = connectMessages(name);
  if (result === "rejected") return messages.failed;
  return result.ok ? null : messages[result.code];
}

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
      const failure = await syncFailure(actions.sync(accountId, draft));
      if (failure) setError(failure);
      else setSynced(draft);
    });

  const disconnect = () =>
    startTransition(async () => {
      setError(null);
      setSynced(null);
      setError(await disconnectFailure(actions.disconnect(accountId)));
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
            const failure = await connectFailure(
              connect({
                accountId,
                provider: form.provider,
                credentials,
                confirmedReadOnly,
              }),
              form.name,
            );
            if (failure) setError(failure);
            else onClose();
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
