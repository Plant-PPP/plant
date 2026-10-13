"use client";

import { Trash2 } from "lucide-react";
import type { Ref } from "react";

import { choose } from "@/components/portfolio-setup/field-alert";
import { IconButton } from "@/components/ui/icon-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConversationSummary } from "@/lib/assistant/chat";
import { formatDate } from "@/lib/format/date";
import { countOf } from "@/lib/format/text";

// The value of the history's first item, which starts a conversation.
const NEW = "new";

// The bar over the chat: the conversations to go back to, the open one's
// title, and deleting it.
export function ChatHeader({
  conversations,
  active,
  onOpen,
  onDelete,
  historyRef,
}: {
  conversations: readonly ConversationSummary[];
  active: ConversationSummary | undefined;
  // Opens a conversation, or a new one with null.
  onOpen: (conversationId: string | null) => void;
  onDelete: () => void;
  // Where focus goes back to once a conversation is deleted.
  historyRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-muted-foreground/20 pb-2 sm:grid-cols-[1fr_auto_1fr]">
      <Select
        value={active?.id ?? NEW}
        onValueChange={choose((value) => onOpen(value === NEW ? null : value))}
      >
        <SelectTrigger
          ref={historyRef}
          size="sm"
          aria-label="Conversaciones"
          className="w-full max-w-[230px] text-xs"
        >
          <SelectValue>{active?.title ?? "Nueva conversación"}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="w-[230px] rounded-xl">
          <SelectItem
            value={NEW}
            className="mb-1 rounded-lg bg-primary text-xs text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground"
          >
            Nueva conversación
          </SelectItem>
          {conversations.length > 0 && <SelectSeparator className="mt-0" />}
          {conversations.map((conversation) => (
            <SelectItem
              key={conversation.id}
              value={conversation.id}
              className="mb-1 rounded-lg last:mb-0"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-xs">{conversation.title}</span>
                <span className="text-muted-foreground text-xs">
                  {`${formatDate(conversation.updatedOn)} · ${countOf(
                    conversation.questions,
                    "pregunta",
                    "preguntas",
                  )}`}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="hidden max-w-md truncate text-sm font-medium sm:block">
        {active?.title}
      </p>
      <div className="flex justify-end">
        {active && (
          <IconButton
            icon={Trash2}
            tooltip="Borrar"
            label="Borrar conversación"
            onClick={onDelete}
          />
        )}
      </div>
    </div>
  );
}
