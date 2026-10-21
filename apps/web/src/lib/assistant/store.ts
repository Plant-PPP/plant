import type { ChatUnit } from "./chat";

// A chat message as it is kept: the AI SDK's UI message, without depending on
// the SDK.
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
  metadata: Record<string, unknown> | null;
  // What the user answered to the answer's proposals, by tool call id.
  proposalStates?: Record<string, unknown>;
};

// Where the assistant keeps a user's conversations and counts their
// questions. Every call is for the session's user.
export type AssistantStore = {
  // "quota" once the month's questions are used up.
  reserveQuestion(userId: string): Promise<"ok" | "quota">;
  conversation(userId: string, id: string): Promise<{ unit: ChatUnit } | null>;
  // Starting one that exists leaves it as it is.
  startConversation(
    userId: string,
    conversation: { id: string; title: string; unit: ChatUnit },
  ): Promise<void>;
  // The last `turns` questions and answers, oldest first.
  history(
    userId: string,
    conversationId: string,
    turns: number,
  ): Promise<StoredMessage[]>;
  saveTurn(
    userId: string,
    turn: { conversationId: string; messages: StoredMessage[] },
  ): Promise<void>;
};

// A store call that failed. Only the step and the code are kept, never the
// error's details, which may carry a message.
export class AssistantStoreError extends Error {
  override readonly name = "AssistantStoreError";
  constructor(
    readonly step: "reserve" | "conversation" | "start" | "history" | "save",
    readonly code: string,
  ) {
    super(`assistant store ${step} failed: ${code}`);
  }
}
