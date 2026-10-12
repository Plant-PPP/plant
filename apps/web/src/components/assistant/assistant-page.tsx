"use client";

import { ArrowUp, LoaderCircle, MessageSquarePlus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { FilterSelect } from "@/components/holdings/filter-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { leftThisMonth } from "@/lib/format/text";
import {
  type AssistantMessage,
  CHAT_UNITS,
  type ChatUnit,
  type Conversation,
  NOT_ADVICE,
  QUESTIONS_PER_MONTH,
  SUGGESTED_QUESTIONS,
} from "@/lib/assistant/chat";
import { UNIT_LABELS } from "@/lib/holdings/messages";
import { cn } from "@/lib/utils";

import { AnswerChart } from "./answer-chart";

export type AssistantActions = {
  // Asks in a conversation, a new one when its id is not listed yet; resolves
  // with the answer's id once it is in.
  ask: (
    conversationId: string,
    question: string,
    unit: ChatUnit,
  ) => Promise<string>;
  delete: (conversationId: string) => void;
};

const WORDS_PER_TICK = 3;
const TICK_MS = 40;

// An answer's text appearing a few words at a time, as a stream would.
function useRevealed(text: string, animate: boolean): string {
  const words = text.split(" ");
  const [shown, setShown] = useState(animate ? 0 : words.length);
  useEffect(() => {
    if (shown >= words.length) return;
    const timer = setTimeout(
      () => setShown((count) => count + WORDS_PER_TICK),
      TICK_MS,
    );
    return () => clearTimeout(timer);
  }, [shown, words.length]);
  return words.slice(0, shown).join(" ");
}

function Answer({
  message,
  animate,
}: {
  message: AssistantMessage;
  animate: boolean;
}) {
  const text = useRevealed(message.text, animate);
  const done = text.length === message.text.length;
  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-sm leading-relaxed">
        <span className="sr-only">Plant: </span>
        {text}
      </p>
      {done && message.chart && <AnswerChart chart={message.chart} />}
      {done && (
        <p className="text-muted-foreground text-xs">
          {[
            `Calculado el ${formatDate(message.asOf)}`,
            message.rate &&
              `${message.rate.label} ${formatAmount(message.rate.sell, "ars")}`,
            message.sources.length > 0 && message.sources.join(", "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

// The assistant: a conversation about the user's own data, in one unit, with
// the questions it can start from and the conversations before.
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
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  // The answer that just arrived, which streams in and is announced once;
  // opening another conversation lets it go.
  const [arrived, setArrived] = useState<string | null>(null);
  const questionField = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);

  const conversation = conversations.find((each) => each.id === activeId);
  const messages = conversation?.messages ?? [];
  const lastAnswer = messages.find((message) => message.id === arrived);
  const left = Math.max(0, QUESTIONS_PER_MONTH - used);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [conversations, waiting]);

  function ask(question: string) {
    const text = question.trim();
    if (!text || waiting || left === 0) return;
    const conversationId = conversation?.id ?? fresh;
    setActiveId(conversationId);
    setDraft("");
    setArrived(null);
    // A clicked suggestion unmounts, so focus moves to the question field, or
    // to the title when this question used the month's last one.
    (left > 1 ? questionField : heading).current?.focus();
    setWaiting(true);
    void actions
      .ask(conversationId, text, conversation?.unit ?? unit)
      .then(
        (answerId) => setArrived(answerId),
        () => {
          setDraft(text);
          toast.error("No pudimos responder. Probá de nuevo.");
        },
      )
      .finally(() => setWaiting(false));
  }

  function open(conversationId: string | null) {
    setActiveId(conversationId);
    setArrived(null);
  }

  function startNew() {
    open(null);
    setFresh(crypto.randomUUID());
  }

  return (
    <div className="grid min-h-[calc(100svh-8rem)] gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside
        className="hidden flex-col gap-2 md:flex"
        aria-label="Conversaciones"
      >
        <Button
          ref={newButton}
          type="button"
          size="sm"
          variant="outline"
          onClick={startNew}
        >
          <MessageSquarePlus />
          Nueva conversación
        </Button>
        <ul className="grid gap-1">
          {conversations.map((each) => (
            <li key={each.id} className="group flex items-center gap-1">
              <button
                type="button"
                aria-current={each.id === activeId || undefined}
                onClick={() => open(each.id)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm",
                  each.id === activeId
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {each.title}
              </button>
              <button
                type="button"
                aria-label={`Borrar ${each.title}`}
                onClick={() => setDeleting(each)}
                className="text-muted-foreground hover:text-foreground rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        {deleting && (
          <ConfirmDialog
            title="¿Borrar esta conversación?"
            description={`«${deleting.title}» se borra y no se puede recuperar. Las consultas que hiciste siguen contando para este mes.`}
            confirmLabel="Borrar"
            returnFocusTo={() => newButton.current}
            onClose={() => setDeleting(null)}
            onConfirm={() => {
              if (deleting.id === activeId) startNew();
              actions.delete(deleting.id);
              toast.success("Borraste la conversación");
            }}
          />
        )}
      </aside>

      <section
        className="flex min-w-0 flex-col gap-4"
        aria-labelledby={`${id}-title`}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h1
              id={`${id}-title`}
              ref={heading}
              tabIndex={-1}
              className="text-xl font-semibold outline-none"
            >
              {conversation?.title ?? "Asistente"}
            </h1>
            <p className="text-muted-foreground text-xs">
              {`${leftThisMonth(left, QUESTIONS_PER_MONTH, "consultas")} · ${NOT_ADVICE}`}
            </p>
          </div>
          <div className="flex items-end gap-2">
            {conversation && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="md:hidden"
                onClick={startNew}
              >
                <MessageSquarePlus />
                Nueva
              </Button>
            )}
            <FilterSelect
              id={`${id}-unit`}
              label="Responder en"
              value={conversation?.unit ?? unit}
              pending={waiting || conversation !== undefined}
              options={CHAT_UNITS.map(
                (each) => [each, UNIT_LABELS[each]] as const,
              )}
              onChange={(value) => setUnit(value as ChatUnit)}
            />
          </div>
        </div>

        <p role="status" className="sr-only">
          {waiting
            ? "Consultando tus datos…"
            : lastAnswer?.role === "assistant"
              ? lastAnswer.text
              : ""}
        </p>
        <div className="flex flex-1 flex-col gap-6">
          {messages.length === 0 && !waiting && (
            <div className="grid flex-1 place-content-center gap-4 py-10 text-center">
              <p className="text-muted-foreground text-sm">
                Preguntale a Plant sobre tu patrimonio, tus inversiones o tus
                deudas.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    disabled={left === 0}
                    onClick={() => ask(question)}
                    className="hover:bg-muted rounded-full border px-3 py-1.5 text-sm disabled:pointer-events-none disabled:opacity-50"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) =>
            message.role === "user" ? (
              <p
                key={message.id}
                className="bg-muted max-w-[85%] self-end rounded-2xl px-4 py-2 text-sm"
              >
                <span className="sr-only">Vos: </span>
                {message.text}
              </p>
            ) : (
              <Answer
                key={message.id}
                message={message}
                animate={message.id === arrived}
              />
            ),
          )}
          {waiting && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              Consultando tus datos…
            </p>
          )}
          <div ref={end} />
        </div>

        <form
          className="bg-background sticky bottom-0 flex items-end gap-2 rounded-xl border p-2"
          onSubmit={(event) => {
            event.preventDefault();
            ask(draft);
          }}
        >
          <label htmlFor={`${id}-question`} className="sr-only">
            Tu pregunta
          </label>
          <textarea
            id={`${id}-question`}
            ref={questionField}
            value={draft}
            rows={1}
            maxLength={500}
            placeholder={
              left === 0
                ? "Ya usaste las consultas de este mes"
                : "Preguntá sobre tus datos"
            }
            disabled={left === 0}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask(draft);
              }
            }}
            className="placeholder:text-muted-foreground max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Enviar"
            disabled={waiting || draft.trim() === "" || left === 0}
            className="size-9"
          >
            <ArrowUp />
          </Button>
        </form>
      </section>
    </div>
  );
}
