"use client";

import type { ReactNode, Ref } from "react";

import { LoaderCircle, Paperclip } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { Button } from "@/components/ui/button";
import {
  type AssistantMessage,
  type ChatMessage,
  MAX_CHARTS,
  NOT_ADVICE,
  QUESTIONS_PER_MONTH,
} from "@/lib/assistant/chat";
import { formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { leftThisMonth } from "@/lib/format/text";

import { AnswerTable } from "./answer-table";
import { ChartBoundary, ChartCard } from "./chart-card";
import { ProposalCard } from "./proposal-card";

// Writes the user's answer to a proposal; whether it was kept.
export type ProposalAnswerer = (
  messageId: string,
  proposalId: string,
  decision: "confirm" | "decline",
) => Promise<boolean>;

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

// The answer as written, its **bold** spans bold: the model marks figures
// that way, and the rest of Markdown is not used.
export function emphasized(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/).map((piece, index) =>
    /^\*\*[^*\n]+\*\*$/.test(piece) ? (
      <strong key={index} className="font-semibold">
        {piece.slice(2, -2)}
      </strong>
    ) : (
      piece
    ),
  );
}

const Answer = memo(function Answer({
  message,
  animate,
  last,
  onAsk,
  onProposal,
}: {
  message: AssistantMessage;
  animate: boolean;
  // Whether it is the conversation's last answer: only its question takes
  // an answer.
  last: boolean;
  onAsk: (question: string) => void;
  onProposal?: ProposalAnswerer;
}) {
  const text = useRevealed(message.text, animate);
  const done = text.length === message.text.length;
  return (
    <div className="grid w-full gap-3 py-2 text-[13px]">
      <p className="leading-relaxed whitespace-pre-wrap">
        <span className="sr-only">Plant: </span>
        {emphasized(text)}
      </p>
      {done &&
        message.proposals?.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            onAnswer={
              onProposal &&
              ((decision) => onProposal(message.id, proposal.id, decision))
            }
          />
        ))}
      {done && message.question && (
        <div className="grid gap-2">
          <p className="font-medium">{message.question.text}</p>
          {last && (
            <div className="flex flex-wrap gap-2">
              {message.question.options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAsk(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {done && message.table && <AnswerTable table={message.table} />}
      {done &&
        message.charts.slice(0, MAX_CHARTS).map((chart, index) => (
          <ChartBoundary key={index}>
            <ChartCard chart={chart} asOf={message.asOf} />
          </ChartBoundary>
        ))}
      {done && message.asOf !== "" && (
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
});

// The conversation as it reads: the questions it can start from while empty,
// else each question and answer, what is being consulted, and the quota and
// not-advice line as its last line.
export function ChatTranscript({
  messages,
  arrivedId,
  waiting,
  suggestions,
  questionsLeft,
  disclaimerId,
  onAsk,
  onProposal,
  contentRef,
}: {
  messages: readonly ChatMessage[];
  // The answer that just arrived, which reveals itself.
  arrivedId: string | null;
  // What is being consulted while a question waits, or null.
  waiting: string | null;
  suggestions: readonly string[];
  questionsLeft: number;
  disclaimerId: string;
  onAsk: (question: string) => void;
  // Answers one of an answer's proposals; absent, its cards only show.
  onProposal?: ProposalAnswerer;
  // The element whose growth the scroller follows.
  contentRef?: Ref<HTMLDivElement>;
}) {
  const empty = messages.length === 0 && waiting === null;
  return (
    <div ref={contentRef} className="flex min-h-full flex-col">
      {empty ? (
        <div className="mx-auto flex w-full max-w-[768px] flex-1 flex-col items-start justify-center py-16">
          <div aria-hidden className="mb-6 shrink-0 self-center">
            <BrandLogo variant="mark" className="size-6" />
          </div>
          <div className="flex w-full flex-col gap-2">
            {suggestions.map((question) => (
              <button
                key={question}
                type="button"
                disabled={questionsLeft === 0}
                onClick={() => onAsk(question)}
                className="border-muted-foreground/20 bg-background/50 text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full rounded-xl border px-4 py-3 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-[768px] flex-col gap-6">
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="grid max-w-[85%] justify-items-end gap-1 sm:max-w-[80%]">
                  {message.attachments?.map((name) => (
                    <p
                      key={name}
                      className="text-muted-foreground flex items-center gap-1 text-xs"
                    >
                      <Paperclip aria-hidden className="size-3" />
                      {name}
                    </p>
                  ))}
                  <p className="bg-primary text-primary-foreground rounded-lg p-2 text-[13px] break-words whitespace-pre-wrap">
                    <span className="sr-only">Vos: </span>
                    {message.text}
                  </p>
                </div>
              </div>
            ) : (
              <Answer
                key={message.id}
                message={message}
                animate={message.id === arrivedId}
                last={message.id === messages.at(-1)?.id}
                onAsk={onAsk}
                onProposal={onProposal}
              />
            ),
          )}
          {waiting !== null && (
            <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {waiting}
            </p>
          )}
        </div>
      )}
      <p
        id={disclaimerId}
        className="text-muted-foreground mt-auto w-full pt-6 text-center text-[10px]"
      >
        {`${leftThisMonth(questionsLeft, QUESTIONS_PER_MONTH, "consultas")} · ${NOT_ADVICE}`}
      </p>
    </div>
  );
}
