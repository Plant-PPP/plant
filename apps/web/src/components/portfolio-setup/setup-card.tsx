"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type * as React from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ListView } from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { settle } from "@/lib/server-action-call";
import type { Answer } from "./answers";

export type SetupCardState = ReturnType<typeof useSetupCard>;

// The heading and pending state of one card on the accounts page.
export function useSetupCard() {
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, startTransition] = useTransition();

  // Runs a row's action and toasts its result. A done row moved to the other
  // list, so its button is gone: focus goes to the card's heading instead of
  // falling to the page.
  function rowAction(
    call: () => Promise<WriteResult>,
    answerOf: (result: WriteResult | "rejected") => Answer,
    { done, askName }: { done: string; askName?: () => void },
  ) {
    if (pending) return;
    startTransition(async () => {
      const answer = answerOf(await settle(call()));
      if (answer.kind === "alert") toast.error(answer.text);
      if (answer.kind === "done") {
        toast.success(done);
        heading.current?.focus();
      }
      if (answer.kind === "ask_name") askName?.();
    });
  }

  return {
    heading,
    focusHeading: () => heading.current,
    pending,
    rowAction,
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
    <Card className="max-w-3xl gap-0">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">
          <h2 ref={heading} tabIndex={-1} className="outline-none">
            {title}
          </h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button size="sm" disabled={pending} onClick={onAdd}>
            <Plus />
            {addLabel}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 pt-6">{children}</CardContent>
    </Card>
  );
}

// The active rows, or a line when there are none, and a note when only the
// most recent are shown.
export function ActiveList<Row extends { id: string }>({
  view,
  emptyText,
  truncatedText,
  renderRow,
}: {
  view: ListView<Row>;
  emptyText: string;
  truncatedText: string;
  renderRow: (row: Row) => React.ReactNode;
}) {
  return (
    <>
      {view.active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {view.active.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              {renderRow(row)}
            </li>
          ))}
        </ul>
      )}
      {view.activeTruncated && (
        <p className="text-xs text-muted-foreground">{truncatedText}</p>
      )}
    </>
  );
}

// The archived rows, one page at a time, in a group closed until opened or
// paged.
export function ArchivedList<Row extends { id: string }>({
  view,
  label,
  emptyText,
  firstPageLabel,
  renderRow,
}: {
  view: ListView<Row>;
  label: string;
  emptyText: string;
  firstPageLabel: string;
  renderRow: (row: Row) => React.ReactNode;
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

  if (view.archived.length === 0 && !view.archivedFirstHref) return null;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={summary} className="cursor-pointer text-sm font-medium">
        {label}
      </summary>
      {view.archived.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      )}
      <ul className="mt-2 divide-y rounded-md border empty:hidden">
        {view.archived.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            {renderRow(row)}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-4 text-sm">
        {view.archivedFirstHref && (
          <Link
            className="underline"
            href={view.archivedFirstHref}
            onNavigate={() => (paging.current = true)}
            scroll={false}
          >
            {firstPageLabel}
          </Link>
        )}
        {view.archivedNextHref && (
          <Link
            className="underline"
            href={view.archivedNextHref}
            onNavigate={() => (paging.current = true)}
            scroll={false}
          >
            Ver más
          </Link>
        )}
      </div>
    </details>
  );
}
