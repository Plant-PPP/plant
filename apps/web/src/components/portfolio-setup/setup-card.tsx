"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DataTable,
  type DataTableRow,
  rowActionButton,
} from "@/components/ui/data-table";
import { PendingButton } from "@/components/ui/pending-button";
import type { ListView } from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { type Answer, type WriteMessages, dialogAnswer } from "./answers";
import type { SetupChange } from "./list-change";
import type { SetupRun } from "./setup-actions";

type SetupCardState = ReturnType<typeof useSetupCard>;

// A dialog a refused write opens again, with what the user typed and the
// alert.
export type Retry<Initial> = { initial?: Initial; initialError?: string };

type RowChange = SetupChange & {
  change: { kind: "archive" | "restore" };
};

// The heading of one list section on the accounts page and the feedback of its
// actions, which the page runs.
export function useSetupCard({
  run,
  pending,
}: {
  run: SetupRun;
  pending: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The row button to return focus to once a refused row action is back.
  const refocus = useRef<{ rowId: string; actionId: string } | null>(null);
  // A refused dialog write's alert until the commit that ends the write, which
  // shows the dialog again. When the page is left mid-write, or a navigation
  // that waited for the write commits with the reopen, the section is gone and
  // the alert is a toast.
  const unshown = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!pending) unshown.current = null;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (unshown.current) toast.error(unshown.current);
      unshown.current = null;
    };
  }, []);

  // Returns focus to a refused row action's button on the commit that ends the
  // write, where the lists' rollback has brought the row back.
  useEffect(() => {
    const target = refocus.current;
    if (!target || pending) return;
    refocus.current = null;
    const section = heading.current?.closest<HTMLElement>(
      '[data-slot="setup-section"]',
    );
    const button =
      section && rowActionButton(section, target.rowId, target.actionId);
    if (!button) return;
    // The user may have moved on while the action ran.
    const active = document.activeElement;
    if (active !== heading.current && active !== document.body) return;
    // A restore button may sit in an archived group mounted closed again.
    const group = button.closest("details");
    if (group) group.open = true;
    button.focus();
  });

  // Runs a row's action. The row leaves its list at once, taking its button,
  // so focus goes to the section's heading, never the page; a refusal brings the
  // row back and focus returns to its button.
  function rowAction(
    change: RowChange,
    call: () => Promise<WriteResult>,
    answerOf: (result: WriteResult | "rejected") => Answer,
    {
      done,
      rowId,
      actionId,
      askName,
    }: { done: string; rowId: string; actionId: string; askName?: () => void },
  ) {
    if (pending) return;
    heading.current?.focus();
    run(change, call, answerOf, (answer) => {
      if (answer.kind === "done") toast.success(done);
      if (answer.kind === "alert") {
        toast.error(answer.text);
        refocus.current = { rowId, actionId };
      }
      if (answer.kind === "ask_name") askName?.();
    });
  }

  // Runs a dialog's write as the dialog closes: a toast when done, or the
  // dialog again with its alert (a toast once the section is gone). False when
  // another write is running, so the dialog stays open with what the user typed.
  function dialogAction(
    change: SetupChange,
    call: () => Promise<WriteResult>,
    messages: WriteMessages,
    { done, reopen }: { done: string; reopen: (error: string) => void },
  ): boolean {
    return run(
      change,
      call,
      (result) => dialogAnswer(result, messages),
      (answer) => {
        if (answer.kind === "done") toast.success(done);
        else if (answer.kind === "alert") {
          if (!mounted.current) toast.error(answer.text);
          else {
            unshown.current = answer.text;
            reopen(answer.text);
          }
        }
      },
    );
  }

  return {
    heading,
    focusHeading: () => heading.current,
    rowAction,
    dialogAction,
  };
}

export function SetupCard({
  heading,
  pending,
  title,
  description,
  addLabel,
  onAdd,
  children,
}: {
  heading: SetupCardState["heading"];
  pending: boolean;
  title: string;
  description: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="setup-section" className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-lg leading-none font-semibold outline-none"
          >
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <PendingButton size="sm" pending={pending} onClick={onAdd}>
          <Plus />
          {addLabel}
        </PendingButton>
      </div>
      {children}
    </section>
  );
}

// The active rows, or a line when there are none, and a note when only the
// most recent are shown.
export function ActiveList<Row extends DataTableRow>({
  view,
  title,
  emptyText,
  truncatedText,
  columns,
}: {
  view: ListView<Row>;
  title: string;
  emptyText: string;
  truncatedText: string;
  columns: ColumnDef<Row>[];
}) {
  return (
    <>
      {view.active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <DataTable columns={columns} data={view.active} caption={title} />
      )}
      {view.activeTruncated && (
        <p className="text-xs text-muted-foreground">{truncatedText}</p>
      )}
    </>
  );
}

// The archived rows, one page at a time, in a group closed until opened or
// paged.
export function ArchivedList<Row extends DataTableRow>({
  view,
  title,
  label,
  emptyText,
  firstPageLabel,
  columns,
  pending,
}: {
  view: ListView<Row>;
  title: string;
  label: string;
  emptyText: string;
  firstPageLabel: string;
  columns: ColumnDef<Row>[];
  pending: boolean;
}) {
  const summary = useRef<HTMLElement>(null);
  const paging = useRef(false);
  // Seeded once: paging back to the first archived page keeps it open.
  const [open, setOpen] = useState(view.archivedFirstHref !== null);

  // The page reached through an archived-list link may not have that link,
  // and focus would fall to the page: it goes to the list's summary instead.
  useEffect(() => {
    if (!paging.current) return;
    paging.current = false;
    if (document.activeElement === document.body) summary.current?.focus();
  }, [view.archivedFirstHref, view.archivedNextHref]);

  // Paging while a write runs would render a page read before the write, so
  // the links wait for it.
  function pageLink(href: string, text: string) {
    return (
      <Link
        className="underline aria-disabled:opacity-50"
        href={href}
        aria-disabled={pending || undefined}
        onNavigate={(event) => {
          if (pending) event.preventDefault();
          else paging.current = true;
        }}
        scroll={false}
      >
        {text}
      </Link>
    );
  }

  if (view.archived.length === 0 && !view.archivedFirstHref) return null;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={summary} className="cursor-pointer text-sm font-medium">
        {label}
      </summary>
      {view.archived.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="mt-2 text-muted-foreground">
          <DataTable
            columns={columns}
            data={view.archived}
            caption={`${title} ${label.toLowerCase()}`}
          />
        </div>
      )}
      <div className="mt-2 flex gap-4 text-sm">
        {view.archivedFirstHref &&
          pageLink(view.archivedFirstHref, firstPageLabel)}
        {view.archivedNextHref && pageLink(view.archivedNextHref, "Ver más")}
      </div>
    </details>
  );
}
