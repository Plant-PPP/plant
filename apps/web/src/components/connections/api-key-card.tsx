"use client";

import { PAGE_BUTTON_CLASS, PageButton } from "@/components/ui/page-button";
import { DialogActions } from "@/components/ui/dialog-actions";
import { Notice } from "@/components/ui/notice";
import { buenosAiresDate } from "@plant/shared";
import type { ConnectionDraft, ReadPeriod } from "@plant/sources";
import {
  ArrowRight,
  CircleCheck,
  KeyRound,
  ListOrdered,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PendingButton } from "@/components/ui/pending-button";
import {
  type ApiKeyActions,
  type ApiKeyView,
  type ConnectionForm,
  type LastSync,
  type ConnectResult,
  connectMessages,
  type DisconnectResult,
  SYNC_MESSAGES,
  SYNC_PERIOD_START,
  type SyncResult,
} from "@/lib/connections/api-key";
import { formatDate } from "@/lib/format/date";
import {
  importFailureMessage,
  isBusy,
  SUPERSEDED_SYNC_MESSAGE,
} from "@/lib/imports/review";
import { settle } from "@/lib/server-action-call";
import { cn } from "@/lib/utils";

const FOLLOW_MS = 2000;

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
  const [dialog, setDialog] = useState<
    "connect" | "disconnect" | "operations" | null
  >(null);
  const operationsOpener = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sync = (draft: ConnectionDraft, period?: ReadPeriod) =>
    startTransition(async () => {
      setError(null);
      setConnected(false);
      const failure = await syncFailure(actions.sync(accountId, draft, period));
      if (failure) setError(failure);
      else router.refresh();
    });

  // While the latest sync is queued or being read, the card asks the server
  // again until it is ready or failed.
  const following = apiKey?.lastSync ? isBusy(apiKey.lastSync.status) : false;
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => router.refresh(), FOLLOW_MS);
    return () => clearInterval(timer);
  }, [following, router]);

  const disconnect = () =>
    startTransition(async () => {
      setError(null);
      setConnected(false);
      setError(await disconnectFailure(actions.disconnect(accountId)));
    });

  return (
    <section
      aria-labelledby={headingId}
      className="border-primary/15 bg-muted/40 grid gap-3 rounded-lg border p-3"
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          !apiKey && "justify-between",
        )}
      >
        <div className={cn("grid gap-0.5", apiKey && "contents")}>
          <h2
            id={headingId}
            className={cn(
              "flex items-center gap-2 text-sm font-medium",
              apiKey && "sr-only",
            )}
          >
            <KeyRound aria-hidden className="text-primary size-4" />
            Conexión con {form.name}
          </h2>
          {!apiKey && (
            <p className="text-muted-foreground text-xs">
              Conectá tu cuenta de {form.name} para traer tus tenencias sin
              subir archivos. Plant solo lee: nunca opera ni retira.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {apiKey ? (
            <>
              <PendingButton
                type="button"
                className={PAGE_BUTTON_CLASS}
                pending={pending}
                onClick={() => sync("holdings")}
              >
                <RefreshCw aria-hidden />
                Sincronizar
              </PendingButton>
              {form.drafts.includes("operations") && (
                <PendingButton
                  ref={operationsOpener}
                  type="button"
                  variant="outline"
                  className={PAGE_BUTTON_CLASS}
                  pending={pending}
                  onClick={() => setDialog("operations")}
                >
                  <ListOrdered aria-hidden />
                  Traer operaciones
                </PendingButton>
              )}
              <Button
                ref={opener}
                type="button"
                variant="outline"
                className={PAGE_BUTTON_CLASS}
                onClick={() => setDialog("disconnect")}
              >
                Desconectar
              </Button>
            </>
          ) : (
            <Button
              ref={opener}
              type="button"
              variant="outline"
              className={PAGE_BUTTON_CLASS}
              onClick={() => setDialog("connect")}
            >
              Conectar {form.name}
            </Button>
          )}
        </div>
      </div>
      {connected && (
        <Notice variant="success">
          Conectamos tu cuenta de {form.name}. Sincronizala para traer tus
          tenencias.
        </Notice>
      )}
      {!connected && apiKey?.lastSync && (
        <SyncStatus sync={apiKey.lastSync} provider={form.name} />
      )}
      {error && <FormAlert>{error}</FormAlert>}
      {dialog === "operations" && (
        <OperationsDialog
          name={form.name}
          returnFocusTo={() => operationsOpener.current}
          onClose={() => setDialog(null)}
          onSubmit={(period) => {
            setDialog(null);
            sync("operations", period);
          }}
        />
      )}
      {dialog === "connect" && (
        <ConnectDialog
          accountId={accountId}
          form={form}
          connect={actions.connect}
          onConnected={() => {
            setError(null);
            setConnected(true);
          }}
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

// How the account's latest sync stands: read and waiting in Cargar (or
// confirmed), still running, or failed and why.
export function SyncStatus({
  sync,
  provider,
}: {
  sync: LastSync;
  provider: string;
}) {
  const when = `${formatDate(sync.on)} a las ${sync.at}`;
  if (isBusy(sync.status)) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <LoaderCircle aria-hidden className="text-warn size-4 animate-spin" />
        Sincronizando desde el {when}.
      </p>
    );
  }
  if (sync.status === "failed") {
    return (
      <Notice
        variant="error"
        title={`La última sincronización falló (${when})`}
      >
        {sync.failure
          ? importFailureMessage(sync.failure, provider)
          : SUPERSEDED_SYNC_MESSAGE}
      </Notice>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-2 text-sm">
        <CircleCheck aria-hidden className="text-gain size-4 shrink-0" />
        <span>
          Última sincronización: {when}.
          {sync.status === "ready" && " Está lista para revisar."}
        </span>
      </p>
      {sync.status === "ready" && (
        <PageButton asChild>
          <Link href={`/import/${sync.importId}`}>
            Revisar
            <ArrowRight aria-hidden />
          </Link>
        </PageButton>
      )}
    </div>
  );
}

// A year back from a Buenos Aires day, as YYYY-MM-DD.
export const yearBefore = (day: string): string =>
  `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`.replace(/-02-29$/, "-02-28");

// The days the operations sync reads: a year up to today unless the user
// picks others. Operations already in the account come back marked in the
// review, so a period that overlaps an earlier one writes nothing twice.
function OperationsDialog({
  name,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  name: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (period: ReadPeriod) => void;
}) {
  const id = useId();
  const today = buenosAiresDate(new Date());
  const [from, setFrom] = useState(yearBefore(today));
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);

  return (
    <AppDialog
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      title={`Traer operaciones de ${name}`}
      icon={ListOrdered}
      description="Elegí desde y hasta qué día. Después revisás cada operación en Cargar y elegís cuáles importar; las que ya están en la cuenta aparecen marcadas."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const failure = periodFailure(from, to, today);
          if (failure) setError(failure);
          else onSubmit({ from, to });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-from`}>Desde</Label>
            <Input
              id={`${id}-from`}
              type="date"
              required
              min={SYNC_PERIOD_START}
              max={today}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-to`}>Hasta</Label>
            <Input
              id={`${id}-to`}
              type="date"
              required
              min={SYNC_PERIOD_START}
              max={today}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        {!periodFailure(from, to, today) && (
          <p className="text-muted-foreground text-sm">
            Vamos a traer las operaciones del{" "}
            <span className="text-foreground font-medium">
              {formatDate(from)}
            </span>{" "}
            al{" "}
            <span className="text-foreground font-medium">
              {formatDate(to)}
            </span>
            .
          </p>
        )}
        {error && <FormAlert>{error}</FormAlert>}
        <DialogActions submitLabel="Traer operaciones" />
      </form>
    </AppDialog>
  );
}

// Why the period cannot be read, in the user's words; null when it can.
export function periodFailure(
  from: string,
  to: string,
  today: string,
): string | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) || !day.test(to)) return "Elegí las dos fechas.";
  if (from < SYNC_PERIOD_START) return "Elegí una fecha desde el año 2000.";
  if (from > to)
    return "La fecha de inicio tiene que ser anterior a la de fin.";
  if (to > today) return "La fecha de fin no puede ser posterior a hoy.";
  return null;
}

function ConnectDialog({
  accountId,
  form,
  connect,
  onConnected,
  onClose,
}: {
  accountId: string;
  form: ConnectionForm;
  connect: ApiKeyActions["connect"];
  onConnected: () => void;
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
      icon={KeyRound}
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
            else {
              onConnected();
              onClose();
            }
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
        <DialogActions submitLabel="Conectar" pending={pending} />
      </form>
    </AppDialog>
  );
}
