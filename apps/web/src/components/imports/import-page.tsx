"use client";

import { PageButton } from "@/components/ui/page-button";
import { FilterSelect } from "@/components/holdings/filter-select";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Camera,
  CircleAlert,
  CircleCheck,
  CircleDot,
  FileUp,
  Files,
  LoaderCircle,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";
import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { formatDate } from "@/lib/format/date";
import { leftThisMonth } from "@/lib/format/text";
import {
  IMPORT_STATUS_LABELS,
  type ImportItem,
  IMPORTS_PER_MONTH,
  isBusy,
} from "@/lib/imports/review";
import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import { cn } from "@/lib/utils";
import { ConsentCard } from "./consent-card";

export type ImportActions = {
  // Starts reading each file into the account, or into none; each import's
  // status then changes on its own.
  upload: (files: readonly File[], accountId: string | null) => void;
};

// The select's value for a file that belongs to no account.
const NO_ACCOUNT = "none";

const ACCEPT = ".pdf,.csv,.xls,.xlsx,image/*";

// An import's status as a row shows it: a colored icon and its label.
function StatusBadge({ item }: { item: ImportItem }) {
  const busy = isBusy(item.status);
  const Icon = busy
    ? LoaderCircle
    : item.status === "ready"
      ? CircleDot
      : item.status === "failed"
        ? CircleAlert
        : CircleCheck;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0",
          busy && "text-muted-foreground animate-spin",
          item.status === "ready" && "text-primary",
          item.status === "failed" && "text-destructive",
          item.status === "confirmed" && "text-gain",
        )}
      />
      {IMPORT_STATUS_LABELS[item.status]}
    </span>
  );
}

// Upload a broker's statement, a screenshot or a spreadsheet into an account,
// or a card statement or a loan's into none, and follow each import until it
// is ready to review. A file of holdings or operations uploaded to no account
// asks for its account at its review.
export function ImportPage({
  accounts,
  archivedAccounts,
  imports,
  used,
  reviewHref,
  actions,
  consent,
}: {
  accounts: SourceConnectionRow[];
  // Named in the list of earlier imports, never offered for a new one.
  archivedAccounts: SourceConnectionRow[];
  imports: ImportItem[];
  // The uploads made this month.
  used: number;
  reviewHref: (id: string) => string;
  actions: ImportActions;
  // On a page that asks for the terms: whether the user accepted the ones in
  // force, and the accepting; the upload waits for it.
  consent?: { accepted: boolean; accept: () => void };
}) {
  const id = useId();
  const [choice, setChoice] = useState(NO_ACCOUNT);
  // An account archived since it was chosen is no choice any more.
  const accountId = accounts.some((each) => each.id === choice) ? choice : null;
  const [dragging, setDragging] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const left = Math.max(0, IMPORTS_PER_MONTH - used);
  const latestReady = imports.find((item) => item.status === "ready");
  const institution = (accountId: string) =>
    [...accounts, ...archivedAccounts].find((each) => each.id === accountId)
      ?.institution ?? "";

  function send(list: FileList | null) {
    if (!list || list.length === 0) return;
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
            <span className="text-muted-foreground block text-xs">
              {item.error}
            </span>
          )}
        </>
      ),
    },
    {
      id: "account",
      header: "Cuenta",
      size: 144,
      meta: { className: "hidden @2xl:table-cell" },
      cell: ({ row: { original: item } }) =>
        item.accountId === null ? (
          <span className="text-muted-foreground">Sin cuenta</span>
        ) : (
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
      size: 248,
      cell: ({ row: { original: item } }) => (
        <span className="flex items-center justify-end gap-3 whitespace-nowrap">
          <StatusBadge item={item} />
          {item.status === "ready" && (
            <PageButton asChild>
              <Link href={reviewHref(item.id)}>Revisar</Link>
            </PageButton>
          )}
        </span>
      ),
      meta: { className: "text-right" },
    },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Cargar"
        filters={
          !(consent && !consent.accepted) && (
            <FilterSelect
              id={`${id}-account`}
              label="Cuenta"
              shownLabel
              value={accountId ?? NO_ACCOUNT}
              pending={false}
              options={[
                [NO_ACCOUNT, "Sin cuenta (deudas, tarjetas)"],
                ...accounts.map((each) => [each.id, each.institution] as const),
              ]}
              onChange={setChoice}
              triggerClassName="sm:min-w-48"
            />
          )
        }
        actions={
          <div className="grid gap-1 text-right">
            <span className="text-muted-foreground text-xs">
              {leftThisMonth(left, IMPORTS_PER_MONTH, "cargas")}
            </span>
            <span className="bg-muted ml-auto h-1 w-32 overflow-hidden rounded-full">
              <span
                className="bg-primary block h-full"
                style={{ width: `${(used / IMPORTS_PER_MONTH) * 100}%` }}
              />
            </span>
          </div>
        }
      />

      {consent && !consent.accepted ? (
        <ConsentCard onAccept={consent.accept} />
      ) : (
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
            "border-muted-foreground/25 grid place-items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center md:p-10",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <FileUp aria-hidden className="text-muted-foreground size-6" />
          <p className="grid gap-1">
            <span className="text-sm font-medium">
              Arrastrá acá uno o varios archivos
            </span>
            <span className="text-muted-foreground text-xs">
              PDF, fotos o capturas, CSV o Excel
            </span>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <PageButton
              type="button"
              variant="default"
              disabled={left === 0}
              onClick={() => files.current?.click()}
            >
              <Upload />
              Elegir archivos
            </PageButton>
            {/* A phone opens its camera; a computer would only open the
                same file picker, so it gets no such button. */}
            <PageButton
              type="button"
              className="hidden pointer-coarse:inline-flex"
              disabled={left === 0}
              onClick={() => camera.current?.click()}
            >
              <Camera />
              Sacar foto
            </PageButton>
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
      )}

      <Section title="Tus cargas" icon={Files}>
        {imports.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
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
      </Section>
    </div>
  );
}
