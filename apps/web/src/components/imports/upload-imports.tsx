"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";

import { watchImports } from "@/lib/imports/live";
import { type ImportItem, isBusy } from "@/lib/imports/review";
import type {
  FinishResult,
  StartResult,
  UploadCode,
} from "@/lib/imports/write";
import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import { UPLOAD_BUCKET } from "@/lib/imports/upload";
import { settle } from "@/lib/server-action-call";
import { createClient } from "@/lib/supabase/client";

import { ImportPage } from "./import-page";

// What the user reads when a file is refused, after its name.
export const UPLOAD_MESSAGES: Record<UploadCode, string> = {
  invalid: "no pudimos leer el archivo.",
  type: "no es un PDF, una imagen, un CSV ni un Excel.",
  size: "tiene que pesar entre 1 byte y 20 MB.",
  terms: "aceptá los términos antes de subir archivos.",
  not_found: "esa cuenta ya no está disponible.",
  duplicate: "ya lo subiste a esta cuenta.",
  quota: "ya usaste las cargas de este mes.",
  failed: "no pudimos subirlo. Probá de nuevo.",
};

export type UploadActions = {
  start: (input: unknown) => Promise<StartResult>;
  finish: (input: unknown) => Promise<FinishResult>;
  acceptTerms: () => Promise<{ ok: boolean }>;
};

// Sends one file: asks for a signed URL, puts the file there straight from the
// browser, and has the server check it and start its import. A call that
// fails reads as "failed".
export async function uploadOne(
  file: File,
  accountId: string,
  actions: Pick<UploadActions, "start" | "finish">,
  put: (
    path: string,
    token: string,
    file: File,
    type: string,
  ) => Promise<{ error: unknown }>,
): Promise<UploadCode | null> {
  const started = await settle(
    actions.start({ fileName: file.name, size: file.size, accountId }),
  );
  if (started === "rejected") return "failed";
  if (!started.ok) return started.code;
  const { error } = await put(started.path, started.token, file, started.type);
  if (error) return "failed";
  const finished = await settle(
    actions.finish({
      uploadId: started.uploadId,
      path: started.path,
      fileName: file.name,
      accountId,
    }),
  );
  if (finished === "rejected") return "failed";
  return finished.ok ? null : finished.code;
}

const putToSignedUrl = async (
  path: string,
  token: string,
  file: File,
  type: string,
) =>
  createClient()
    .storage.from(UPLOAD_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: type });

const reviewHref = (id: string) => `/import/${id}`;

// Several changes within this window re-read the page once.
const REFRESH_DELAY_MS = 250;

// Cargar over the database: each file goes to Storage and starts a queued
// import; the list refreshes once every file is sent, and again on each change
// to an import while one is queued or being read.
export function UploadImports({
  userId,
  accounts,
  archivedAccounts,
  imports,
  used,
  termsAccepted,
  actions,
}: {
  userId: string;
  accounts: SourceConnectionRow[];
  archivedAccounts: SourceConnectionRow[];
  imports: ImportItem[];
  used: number;
  termsAccepted: boolean;
  actions: UploadActions;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const following = imports.some((item) => isBusy(item.status));

  // The channel stays open only while an import is in flight: an open channel
  // has the browser refresh a session near its expiry
  // (lib/supabase/client.ts).
  useEffect(() => {
    if (!following) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);
    };
    const stop = watchImports(createClient(), userId, refresh);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [following, userId, router]);

  function upload(files: readonly File[], accountId: string) {
    startTransition(async () => {
      let sent = 0;
      for (const file of files) {
        const code = await uploadOne(file, accountId, actions, putToSignedUrl);
        if (code === null) sent += 1;
        else toast.error(`${file.name}: ${UPLOAD_MESSAGES[code]}`);
      }
      if (sent > 0) {
        toast.success(
          sent === 1 ? "Subimos el archivo." : `Subimos ${sent} archivos.`,
        );
      }
      router.refresh();
    });
  }

  function accept() {
    startTransition(async () => {
      const result = await settle(actions.acceptTerms());
      if (result === "rejected" || !result.ok)
        toast.error("No pudimos guardar tu aceptación. Probá de nuevo.");
      router.refresh();
    });
  }

  return (
    <ImportPage
      accounts={accounts}
      archivedAccounts={archivedAccounts}
      imports={imports}
      used={used}
      reviewHref={reviewHref}
      actions={{ upload }}
      consent={{ accepted: termsAccepted, accept }}
    />
  );
}
