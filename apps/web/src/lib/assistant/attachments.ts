// The files a user attaches to a question, kept for the conversation so its
// later turns read them again.

// A file the user attached: an image or a PDF, read by the model as it is.
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
