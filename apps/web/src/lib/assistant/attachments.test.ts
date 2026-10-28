import {
  attachmentPath,
  isAttachmentOf,
  keptAttachmentsOf,
} from "./attachments";

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";

it("reads a question's files as kept now and as only their names before", () => {
  expect(
    keptAttachmentsOf({
      attachments: [
        { filename: "log.png", mediaType: "image/png", path: "p" },
        "viejo.pdf",
        { mediaType: "image/png" },
      ],
    }),
  ).toEqual([
    { filename: "log.png", mediaType: "image/png", path: "p" },
    { filename: "viejo.pdf", mediaType: null, path: null },
  ]);
  expect(keptAttachmentsOf(null)).toEqual([]);
});

it("keeps a file in the user's folder of the conversation, and reads only from there", () => {
  const path = attachmentPath(USER, CONVERSATION, "msg1", 0);
  expect(path).toBe(`${USER}/assistant/${CONVERSATION}/msg1-0`);
  expect(isAttachmentOf(path, USER, CONVERSATION)).toBe(true);
  expect(isAttachmentOf(path, "other", CONVERSATION)).toBe(false);
  expect(isAttachmentOf(path, USER, "other")).toBe(false);
  expect(
    isAttachmentOf(
      `${USER}/assistant/${CONVERSATION}/../x`,
      USER,
      CONVERSATION,
    ),
  ).toBe(false);
});
