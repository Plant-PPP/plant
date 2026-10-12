"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Camera, FileUp, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";
import { Button } from "@/components/ui/button";
import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format/date";
import { leftThisMonth } from "@/lib/format/text";
import {
  IMPORT_STATUS_LABELS,
  type ImportItem,
  IMPORTS_PER_MONTH,
} from "@/lib/imports/review";
import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import { cn } from "@/lib/utils";

export type ImportActions = {
  // Starts reading each file into the account; each import's status then
  // changes on its own.
  upload: (files: readonly File[], accountId: string) => void;
};

const ACCEPT = ".pdf,.csv,.xls,.xlsx,image/*";

function StatusBadge({ item }: { item: ImportItem }) {
  const busy = item.status === "queued" || item.status === "reading";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
        item.status === "ready" && "bg-primary/15 text-foreground",
        item.status === "failed" && "bg-destructive/15 text-destructive",
        item.status === "confirmed" && "bg-muted text-muted-foreground",
        busy && "bg-muted text-foreground",
      )}
    >
      {busy && <LoaderCircle aria-hidden className="size-3 animate-spin" />}
      {IMPORT_STATUS_LABELS[item.status]}
    </span>
  );
}

// Upload a broker's statement, a screenshot or a spreadsheet into an account,
// and follow each import until it is ready to review.
export function ImportPage({
  accounts,
  archivedAccounts,
  imports,
  used,
  reviewHref,
  actions,
}: {
  accounts: SourceConnectionRow[];
  // Named in the list of earlier imports, never offered for a new one.
  archivedAccounts: SourceConnectionRow[];
  imports: ImportItem[];
  // The uploads made this month.
  used: number;
  reviewHref: (id: string) => string;
  actions: ImportActions;
}) {
  const id = useId();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [dragging, setDragging] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const left = Math.max(0, IMPORTS_PER_MONTH - used);
  const latestReady = imports.find((item) => item.status === "ready");
  const institution = (accountId: string) =>
    [...accounts, ...archivedAccounts].find((each) => each.id === accountId)
      ?.institution ?? "";

  function send(list: FileList | null) {
    if (!list || list.length === 0 || !accountId) return;
    if (left === 0) {
      toast.error("Ya usaste las cargas de este mes.");
      return;
    }
    actions.upload([...list].slice(0, left), accountId);
    if (list.length > left) {
      toast.error(
        `Subimos ${left} de ${list.length}: no te quedan más cargas este mes.`,
      );
    }
  }

  const columns: ColumnDef<ImportItem>[] = [
    {
      id: "file",
      header: "Archivo",
      cell: ({ row: { original: item } }) => (
        <>
          <TruncatedText className="font-medium" text={item.fileName} />
          {item.error && (
            <span className="text-destructive block text-xs">{item.error}</span>
          )}
        </>
      ),
    },
    {
      id: "account",
      header: "Cuenta",
      size: 144,
      meta: { className: "hidden @2xl:table-cell" },
      cell: ({ row: { original: item } }) => (
        <span className="flex min-w-0 items-center gap-2">
          <InstitutionIcon name={institution(item.accountId)} />
          <TruncatedText text={institution(item.accountId)} />
        </span>
      ),
    },
    {
      id: "date",
      header: "Fecha",
      size: 104,
      meta: { className: "hidden @xl:table-cell text-muted-foreground" },
      cell: ({ row: { original: item } }) => formatDate(item.createdOn),
    },
    {
      id: "status",
      header: "Estado",
      size: 176,
      cell: ({ row: { original: item } }) => (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <StatusBadge item={item} />
          {item.status === "ready" && (
            <Button asChild size="sm" variant="outline" className="h-7">
              <Link href={reviewHref(item.id)}>Revisar</Link>
            </Button>
          )}
        </span>
      ),
      meta: { className: "text-right" },
    },
  ];

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">Cargar</h1>
        <p className="text-muted-foreground text-sm">
          Subí el resumen de tu broker, una captura o un Excel: lo leemos y lo
          revisás antes de guardarlo.
        </p>
      </div>

      <section className="grid gap-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid w-full gap-2 sm:w-64">
            <Label htmlFor={`${id}-account`}>Cuenta</Label>
            <Select
              value={accountId}
              onValueChange={(value) => value && setAccountId(value)}
            >
              <SelectTrigger id={`${id}-account`} className="w-full">
                <SelectValue placeholder="Elegí una cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((each) => (
                  <SelectItem key={each.id} value={each.id}>
                    {each.institution}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1 text-right">
            <span className="text-muted-foreground text-xs">
              {leftThisMonth(left, IMPORTS_PER_MONTH, "cargas")}
            </span>
            <span className="bg-muted h-1.5 w-40 overflow-hidden rounded-full">
              <span
                className="bg-chart-3 block h-full"
                style={{ width: `${(used / IMPORTS_PER_MONTH) * 100}%` }}
              />
            </span>
          </div>
        </div>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            send(event.dataTransfer.files);
          }}
          className={cn(
            "grid place-items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <FileUp aria-hidden className="text-muted-foreground size-8" />
          <p className="text-sm">
            Arrastrá acá uno o varios archivos
            <span className="text-muted-foreground block text-xs">
              PDF, fotos o capturas, CSV o Excel
            </span>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={left === 0 || !accountId}
              onClick={() => files.current?.click()}
            >
              Elegir archivos
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={left === 0 || !accountId}
              onClick={() => camera.current?.click()}
            >
              <Camera />
              Sacar foto
            </Button>
          </div>
          <input
            ref={files}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              send(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              send(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby={`${id}-imports`}>
        <h2 id={`${id}-imports`} className="text-base font-semibold">
          Tus cargas
        </h2>
        {imports.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no subiste nada.
          </p>
        ) : (
          <DataTable caption="Cargas" columns={columns} data={imports} />
        )}
        {/* The newest import ready to review, so each one that gets there is
            announced once, not every earlier one again. */}
        <p role="status" className="sr-only">
          {latestReady && `${latestReady.fileName} está lista para revisar.`}
        </p>
      </section>
    </div>
  );
}
