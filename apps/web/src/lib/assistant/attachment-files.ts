import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { UPLOAD_BUCKET } from "@/lib/imports/upload";
import { errorType } from "@/lib/log/server-log";

import {
  type Attachment,
  attachmentPath,
  isAttachmentOf,
  type KeptAttachment,
  keptAttachmentsOf,
} from "./attachments";
import type { StoredMessage } from "./store";

type Client = SupabaseClient<Database>;

// How long one file's upload or download may take before it counts as
// failed, within the turn's time.
const FILE_MS = 8_000;
// What a turn reads back of earlier files: one question's, as a question
// takes them.
const REPLAY_FILES = 4;
const REPLAY_BYTES = 4_000_000;

async function within<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Keeps a question's files with the session's client, each on its own: one
// that could not be stored keeps only its name, counted with what failed.
export async function keepAttachments(
  client: Client,
  at: { userId: string; conversationId: string; messageId: string },
  files: readonly Attachment[],
): Promise<{ kept: KeptAttachment[]; failed: number; errorType?: string }> {
  let failed = 0;
  let failure: string | undefined;
  const kept = await Promise.all(
    files.map(async (file, index): Promise<KeptAttachment> => {
      const path = attachmentPath(
        at.userId,
        at.conversationId,
        at.messageId,
        index,
      );
      try {
        const { error } = await within(
          client.storage
            .from(UPLOAD_BUCKET)
            .upload(path, Buffer.from(file.data, "base64"), {
              contentType: file.mediaType,
              upsert: false,
            }),
          FILE_MS,
        );
        if (error) throw error;
        return { filename: file.filename, mediaType: file.mediaType, path };
      } catch (error) {
        failed += 1;
        failure ??= errorType(error);
        return {
          filename: file.filename,
          mediaType: file.mediaType,
          path: null,
        };
      }
    }),
  );
  return { kept, failed, ...(failure && { errorType: failure }) };
}

// Storage answers a missing object with a 400 whose body's statusCode is
// "404", or with a 404.
const isMissing = (error: unknown) => {
  const { status, statusCode } = (error ?? {}) as {
    status?: unknown;
    statusCode?: unknown;
  };
  return status === 404 || statusCode === "404";
};

// The files of the latest question in the history that kept any, read back
// with the session's client for the model to read again: only the user's own
// paths of the conversation, at most a question's worth. One no longer there
// is counted missing; one that could not be read, failed.
export async function replayAttachments(
  client: Client,
  at: { userId: string; conversationId: string },
  history: readonly StoredMessage[],
): Promise<{
  messageId: string | null;
  files: Attachment[];
  missing: number;
  failed: number;
  errorType?: string;
}> {
  const latest = history.findLast(
    (message) =>
      message.role === "user" &&
      keptAttachmentsOf(message.metadata).some((each) => each.path !== null),
  );
  if (!latest) return { messageId: null, files: [], missing: 0, failed: 0 };
  const wanted = keptAttachmentsOf(latest.metadata)
    .filter(
      (each): each is KeptAttachment & { path: string; mediaType: string } =>
        each.path !== null &&
        each.mediaType !== null &&
        isAttachmentOf(each.path, at.userId, at.conversationId),
    )
    .slice(0, REPLAY_FILES);
  let missing = 0;
  let failed = 0;
  let failure: string | undefined;
  let bytes = 0;
  const read = await Promise.all(
    wanted.map(async (each): Promise<Attachment | null> => {
      try {
        const { data, error } = await within(
          client.storage.from(UPLOAD_BUCKET).download(each.path),
          FILE_MS,
        );
        if (isMissing(error)) {
          missing += 1;
          return null;
        }
        if (error || !data) throw error ?? new Error("no_data");
        const body = Buffer.from(await data.arrayBuffer());
        bytes += body.length;
        return {
          filename: each.filename,
          mediaType: each.mediaType,
          data: body.toString("base64"),
        };
      } catch (error) {
        failed += 1;
        failure ??= errorType(error);
        return null;
      }
    }),
  );
  const files = read.filter((each): each is Attachment => each !== null);
  // Files past what a question takes are not read again.
  const over = bytes > REPLAY_BYTES;
  return {
    messageId: latest.id,
    files: over ? [] : files,
    missing,
    failed: failed + (over ? files.length : 0),
    ...(failure && { errorType: failure }),
  };
}

// Removes a conversation's kept files with the session's client.
export async function removeAttachments(
  client: Client,
  userId: string,
  conversationId: string,
): Promise<void> {
  const folder = `${userId}/assistant/${conversationId}`;
  const { data, error } = await client.storage
    .from(UPLOAD_BUCKET)
    .list(folder, { limit: 1000 });
  if (error) throw error;
  if (!data || data.length === 0) return;
  const removed = await client.storage
    .from(UPLOAD_BUCKET)
    .remove(data.map((each) => `${folder}/${each.name}`));
  if (removed.error) throw removed.error;
}
