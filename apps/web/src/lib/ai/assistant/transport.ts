import { DefaultChatTransport } from "ai";

import type { AssistantUIMessage } from "./messages";

// How the chat page sends a question: the conversation and its unit, given
// with each message, and the new message only; the server reads the rest of
// the conversation itself.
export const chatTransport = () =>
  new DefaultChatTransport<AssistantUIMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages, body }) => ({
      body: { ...body, message: messages.at(-1) },
    }),
  });
