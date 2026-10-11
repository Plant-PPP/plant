"use client";

import { ArrowUp, LoaderCircle, MessageSquarePlus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { FilterSelect } from "@/components/holdings/filter-select";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
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
  onFollowUp,
}: {
  message: AssistantMessage;
  animate: boolean;
  onFollowUp: (question: string) => void;
}) {
  const text = useRevealed(message.text, animate);
  const done = text.length === message.text.length;
  return (
    <div className="grid max-w-2xl gap-3">
      <p className="text-sm leading-relaxed">{text}</p>
      {done && message.chart && <AnswerChart chart={message.chart} />}
      {done && (
        <>
          <p className="text-muted-foreground text-xs">
            {[
              `Datos al ${formatDate(message.asOf)}`,
              message.rate &&
                `${message.rate.label} ${formatAmount(message.rate.sell, "ars")}`,
              message.sources.length > 0 && message.sources.join(", "),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="flex flex-wrap gap-2">
            {message.followUps.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => onFollowUp(question)}
                className="hover:bg-muted rounded-full border px-3 py-1 text-xs"
              >
                {question}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// The assistant: a conversation about the user's own data, in one unit, with
// the questions it can start from and the conversations before.
export function AssistantPage({
  conversations,
  today,
  actions,
}: {
  conversations: Conversation[];
  today: string;
  actions: AssistantActions;
}) {
  const id = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [unit, setUnit] = useState<ChatUnit>("usd_mep");
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState(false);
  // The answers that arrived while the page was open, which stream in.
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);

  const conversation = conversations.find((each) => each.id === activeId);
  const messages = conversation?.messages ?? [];
  const used = conversations
    .filter((each) => each.updatedOn.slice(0, 7) === today.slice(0, 7))
    .flatMap((each) => each.messages)
    .filter((message) => message.role === "user").length;
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
    setWaiting(true);
    void actions
      .ask(conversationId, text, conversation?.unit ?? unit)
      .then((answerId) =>
        setArrived((current) => new Set([...current, answerId])),
      )
      .finally(() => setWaiting(false));
  }

  function startNew() {
    setActiveId(null);
    setFresh(crypto.randomUUID());
  }

  return (
    <div className="grid min-h-[calc(100svh-8rem)] gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
      <aside
        className="hidden flex-col gap-2 md:flex"
        aria-label="Conversaciones"
      >
        <Button type="button" size="sm" variant="outline" onClick={startNew}>
          <MessageSquarePlus />
          Nueva conversación
        </Button>
        <ul className="grid gap-1">
          {conversations.map((each) => (
            <li key={each.id} className="group flex items-center gap-1">
              <button
                type="button"
                aria-current={each.id === activeId || undefined}
                onClick={() => setActiveId(each.id)}
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
                onClick={() => {
                  if (each.id === activeId) startNew();
                  actions.delete(each.id);
                }}
                className="text-muted-foreground hover:text-foreground rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section
        className="flex min-w-0 flex-col gap-4"
        aria-labelledby={`${id}-title`}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h1 id={`${id}-title`} className="text-xl font-semibold">
              {conversation?.title ?? "Asistente"}
            </h1>
            <p className="text-muted-foreground text-xs">
              {`Te quedan ${left} de ${QUESTIONS_PER_MONTH} consultas este mes · ${NOT_ADVICE}`}
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
              label="Moneda"
              value={conversation?.unit ?? unit}
              pending={waiting || conversation !== undefined}
              options={CHAT_UNITS.map(
                (each) => [each, UNIT_LABELS[each]] as const,
              )}
              onChange={(value) => setUnit(value as ChatUnit)}
            />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-6" aria-live="polite">
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
                    onClick={() => ask(question)}
                    className="hover:bg-muted rounded-full border px-3 py-1.5 text-sm"
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
                {message.text}
              </p>
            ) : (
              <Answer
                key={message.id}
                message={message}
                animate={arrived.has(message.id)}
                onFollowUp={ask}
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
