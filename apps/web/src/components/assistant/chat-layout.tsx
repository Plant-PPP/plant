"use client";

import { ArrowDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { FilterSelect } from "@/components/holdings/filter-select";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CHAT_UNITS,
  type ChatMessage,
  type ChatUnit,
  type ConversationSummary,
} from "@/lib/assistant/chat";
import { UNIT_LABELS } from "@/lib/holdings/messages";

import { ChatComposer } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ChatTranscript } from "./chat-transcript";

// The assistant's page around whichever chat drives it: the history and the
// open conversation's title above, the conversation in the middle, scrolling
// on its own and following its end, and the field below.
export function ChatLayout({
  conversations,
  active,
  onOpen,
  onDelete,
  messages,
  arrivedId,
  waiting,
  announcement,
  suggestions,
  questionsLeft,
  onAsk,
  busy,
  onStop,
  unit,
  unitLocked,
  onUnit,
}: {
  conversations: readonly ConversationSummary[];
  active: ConversationSummary | undefined;
  // Opens a conversation, or a new one with null.
  onOpen: (conversationId: string | null) => void;
  // Deletes a conversation once the user confirmed it, and says so.
  onDelete: (conversationId: string) => void;
  messages: readonly ChatMessage[];
  // The answer that just arrived, which reveals itself.
  arrivedId: string | null;
  // What is being consulted while a question waits, or null.
  waiting: string | null;
  // What screen readers hear once an answer is in.
  announcement: string;
  suggestions: readonly string[];
  questionsLeft: number;
  // Null when the question was not taken; a rejected promise puts it back in
  // the field.
  onAsk: (question: string) => Promise<unknown> | null;
  busy: boolean;
  onStop?: () => void;
  unit: ChatUnit;
  // An open conversation keeps the unit it started in.
  unitLocked: boolean;
  onUnit: (unit: ChatUnit) => void;
}) {
  const id = useId();
  const disclaimerId = `${id}-disclaimer`;
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLButtonElement>(null);

  // A conversation follows its last message while the user reads at its end,
  // as an answer comes in; an empty one stays at its top.
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({ initial: "instant", resize: "smooth" });
  const activeId = active?.id;
  const started = messages.length > 0 || waiting !== null;
  useEffect(() => {
    if (started) void scrollToBottom("instant");
    else if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeId, messages.length, started, scrollRef, scrollToBottom]);

  function ask(question: string) {
    const taken = onAsk(question);
    // A clicked suggestion unmounts, so focus moves to the question field, or
    // to the history when this question used the month's last one.
    if (taken) (questionsLeft > 1 ? questionField : history).current?.focus();
    return taken;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">{active?.title ?? "Asistente"}</h1>
      <ChatHeader
        conversations={conversations}
        active={active}
        historyRef={history}
        onOpen={onOpen}
        onDelete={() => active && setDeleting(active)}
      />
      <p role="status" className="sr-only">
        {waiting ?? announcement}
      </p>
      {/* Positioned, so a long conversation scrolls here instead of growing
          the page past the window. */}
      <div className="relative min-h-[12rem] flex-1">
        <div
          ref={scrollRef}
          tabIndex={0}
          role="region"
          aria-label="Conversación"
          className="absolute inset-0 overflow-y-auto pt-4 outline-none"
        >
          <ChatTranscript
            messages={messages}
            arrivedId={arrivedId}
            waiting={waiting}
            suggestions={suggestions}
            questionsLeft={questionsLeft}
            disclaimerId={disclaimerId}
            onAsk={(question) => void ask(question)?.catch(() => {})}
            contentRef={contentRef}
          />
        </div>
        {started && !isAtBottom && (
          <IconButton
            icon={ArrowDown}
            tooltip="Ir al final"
            label="Ir al final de la conversación"
            onClick={() => void scrollToBottom()}
            className="bg-background absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border shadow-sm"
          />
        )}
      </div>
      <div className="flex-none pt-2">
        <ChatComposer
          onSend={ask}
          disabled={questionsLeft === 0}
          busy={busy}
          onStop={onStop}
          placeholder={
            questionsLeft === 0
              ? "Ya usaste las consultas de este mes"
              : "Preguntá sobre tus datos"
          }
          describedBy={disclaimerId}
          textareaRef={questionField}
          unitPicker={
            <FilterSelect
              id={`${id}-unit`}
              label="Responder en"
              value={unit}
              pending={busy || unitLocked}
              options={CHAT_UNITS.map(
                (each) => [each, UNIT_LABELS[each]] as const,
              )}
              onChange={(value) => onUnit(value as ChatUnit)}
              triggerClassName="h-7 w-auto border-0 text-xs shadow-none"
            />
          }
        />
      </div>
      {deleting && (
        <ConfirmDialog
          title="¿Borrar esta conversación?"
          description={`«${deleting.title}» se borra y no se puede recuperar. Las consultas que hiciste siguen contando para este mes.`}
          confirmLabel="Borrar"
          returnFocusTo={() => history.current}
          onClose={() => setDeleting(null)}
          onConfirm={() => onDelete(deleting.id)}
        />
      )}
    </div>
  );
}
