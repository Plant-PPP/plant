"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { FilterSelect } from "@/components/holdings/filter-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  type AssistantActions,
  CHAT_UNITS,
  type ChatUnit,
  type Conversation,
  consultingText,
  QUESTIONS_PER_MONTH,
  SUGGESTED_QUESTIONS,
} from "@/lib/assistant/chat";
import { UNIT_LABELS } from "@/lib/holdings/messages";

import { ChatComposer } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ChatTranscript } from "./chat-transcript";

// The assistant as a page: a conversation about the user's own data, in one
// unit, with the conversations before in the bar above it. It asks through
// the prototype's actions and waits for each answer whole.
export function AssistantPage({
  conversations,
  used,
  defaultUnit,
  actions,
}: {
  conversations: Conversation[];
  // The unit a new conversation starts in: the user's reference dollar.
  defaultUnit: ChatUnit;
  // The questions asked this month.
  used: number;
  actions: AssistantActions;
}) {
  const id = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [unit, setUnit] = useState<ChatUnit>(defaultUnit);
  // What is being consulted while a question waits, or null.
  const [waiting, setWaiting] = useState<string | null>(null);
  // The answer that just arrived, which reveals itself and is announced once;
  // opening another conversation lets it go.
  const [arrived, setArrived] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const conversation = conversations.find((each) => each.id === activeId);
  const messages = conversation?.messages ?? [];
  const lastAnswer = messages.find((message) => message.id === arrived);
  const left = Math.max(0, QUESTIONS_PER_MONTH - used);
  const disclaimerId = `${id}-disclaimer`;

  // A conversation follows its last message while the user reads at its end,
  // as an answer reveals itself and its charts come in; an empty one stays at
  // its top.
  const following = useRef(true);
  useEffect(() => {
    const region = scroller.current;
    if (!region) return;
    following.current = messages.length > 0 || waiting !== null;
    region.scrollTop = following.current ? region.scrollHeight : 0;
  }, [conversation, messages.length, waiting]);
  useEffect(() => {
    const region = scroller.current;
    const content = region?.firstElementChild;
    if (!region || !content) return;
    const onScroll = () => {
      following.current =
        region.scrollHeight - region.scrollTop - region.clientHeight < 48;
    };
    const observer = new ResizeObserver(() => {
      if (following.current) region.scrollTop = region.scrollHeight;
    });
    region.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(content);
    return () => {
      region.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  function ask(question: string): Promise<unknown> | null {
    const text = question.trim();
    if (!text || waiting !== null || left === 0) return null;
    const conversationId = conversation?.id ?? fresh;
    setActiveId(conversationId);
    setArrived(null);
    // A clicked suggestion unmounts, so focus moves to the question field, or
    // to the history when this question used the month's last one.
    (left > 1 ? questionField : history).current?.focus();
    const asked = conversation?.unit ?? unit;
    setWaiting(consultingText(actions.consults?.(text, asked) ?? []));
    return actions
      .ask(conversationId, text, asked)
      .then(
        (answerId) => setArrived(answerId),
        (error: unknown) => {
          toast.error("No pudimos responder. Probá de nuevo.");
          throw error;
        },
      )
      .finally(() => setWaiting(null));
  }

  function open(conversationId: string | null) {
    setActiveId(conversationId);
    setArrived(null);
    if (conversationId === null) setFresh(crypto.randomUUID());
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">{conversation?.title ?? "Asistente"}</h1>
      <ChatHeader
        conversations={conversations}
        active={conversation}
        historyRef={history}
        onOpen={open}
        onDelete={() => conversation && setDeleting(conversation)}
      />
      <p role="status" className="sr-only">
        {waiting !== null
          ? waiting
          : lastAnswer?.role === "assistant"
            ? lastAnswer.text
            : ""}
      </p>
      {/* Positioned, so a long conversation scrolls here instead of growing
          the page past the window. */}
      <div className="relative min-h-[12rem] flex-1">
        <div
          ref={scroller}
          tabIndex={0}
          role="region"
          aria-label="Conversación"
          className="absolute inset-0 overflow-y-auto pt-4 outline-none"
        >
          <ChatTranscript
            messages={messages}
            arrivedId={arrived}
            waiting={waiting}
            suggestions={SUGGESTED_QUESTIONS}
            questionsLeft={left}
            disclaimerId={disclaimerId}
            onAsk={(question) => void ask(question)?.catch(() => {})}
          />
        </div>
      </div>
      <div className="flex-none pt-2">
        <ChatComposer
          onSend={ask}
          disabled={left === 0}
          busy={waiting !== null}
          placeholder={
            left === 0
              ? "Ya usaste las consultas de este mes"
              : "Preguntá sobre tus datos"
          }
          describedBy={disclaimerId}
          textareaRef={questionField}
          unitPicker={
            <FilterSelect
              id={`${id}-unit`}
              label="Responder en"
              value={conversation?.unit ?? unit}
              pending={waiting !== null || conversation !== undefined}
              options={CHAT_UNITS.map(
                (each) => [each, UNIT_LABELS[each]] as const,
              )}
              onChange={(value) => setUnit(value as ChatUnit)}
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
          onConfirm={() => {
            if (deleting.id === activeId) open(null);
            actions.delete(deleting.id);
            toast.success("Borraste la conversación");
          }}
        />
      )}
    </div>
  );
}
