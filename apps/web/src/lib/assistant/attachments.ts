// The files a user attaches to a question, kept for the conversation so its
// later turns read them again.

import { uploadTypeOf } from "@/lib/imports/upload";

// Spreadsheets the model reads as the text of their first sheet.
export const SPREADSHEET_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

// The files a question may attach: pictures, PDFs and spreadsheets, a few a
// question, each small enough for the request to carry.
export const ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  ...SPREADSHEET_TYPES,
] as const;
export const ATTACHMENT_LIMIT = 4;
export const ATTACHMENT_BYTES = 2_800_000;

export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

const isAttachmentType = (type: string | null): type is AttachmentType =>
  (ATTACHMENT_TYPES as readonly (string | null)[]).includes(type);

export const isSpreadsheet = (type: string) =>
  (SPREADSHEET_TYPES as readonly string[]).includes(type);

// The type a picked file is sent as: its extension's, as browsers name a CSV
// a spreadsheet or nothing at all, or else what the browser says; null for
// one the chat does not take.
export function attachmentTypeOf(file: {
  name: string;
  type: string;
}): AttachmentType | null {
  const named = uploadTypeOf(file.name);
  if (isAttachmentType(named)) return named;
  return isAttachmentType(file.type) ? file.type : null;
}

// A file the user attached: an image or a PDF, read by the model as it is, or
// a spreadsheet, read as text.
export type Attachment = {
  filename: string;
  mediaType: string;
  // Base64, no data: prefix.
  data: string;
};

// A file as its question keeps it in its metadata: its name, and its type and
// where it is stored, unless it could not be (or the question predates kept
// files, which kept only the name).
export type KeptAttachment = {
  filename: string;
  mediaType: string | null;
  path: string | null;
};

// Where a question's file is kept: in the user's folder, by conversation and
// question. Storage's policies keep each user to their own folder.
export const attachmentPath = (
  userId: string,
  conversationId: string,
  messageId: string,
  index: number,
) => `${userId}/assistant/${conversationId}/${messageId}-${index}`;

// Whether a kept path is one of the user's files of the conversation.
export const isAttachmentOf = (
  path: string,
  userId: string,
  conversationId: string,
) =>
  path.startsWith(`${userId}/assistant/${conversationId}/`) &&
  !path.includes("..");

const isText = (value: unknown): value is string => typeof value === "string";

// The files a question's metadata keeps, as written now or as only their
// names.
export function keptAttachmentsOf(metadata: unknown): KeptAttachment[] {
  const attachments =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { attachments?: unknown }).attachments
      : undefined;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((each): KeptAttachment[] => {
    if (isText(each)) return [{ filename: each, mediaType: null, path: null }];
    if (typeof each !== "object" || each === null) return [];
    const { filename, mediaType, path } = each as Record<string, unknown>;
    if (!isText(filename)) return [];
    return [
      {
        filename,
        mediaType: isText(mediaType) ? mediaType : null,
        path: isText(path) ? path : null,
      },
    ];
  });
}
