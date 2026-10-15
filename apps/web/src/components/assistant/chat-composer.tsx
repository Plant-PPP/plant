"use client";

import { isAssistantShortcut, useMac } from "@/lib/platform";
import { ArrowUp, Square } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";

// Where a question is written: the field, the unit the answer comes in, and
// sending. It keeps the draft, so typing re-renders only itself; ⌘K (Ctrl+K)
// anywhere on the page focuses it.
export function ChatComposer({
  onSend,
  disabled,
  busy,
  placeholder,
  unitPicker,
  describedBy,
  textareaRef,
  onStop,
}: {
  // Null when the question was not taken (the draft stays); a rejected
  // promise puts the question back in the field.
  onSend: (question: string) => Promise<unknown> | null;
  disabled: boolean;
  // While an answer is coming; the field stays open, sending waits.
  busy: boolean;
  placeholder: string;
  unitPicker: ReactNode;
  describedBy: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  // Stops an answer that is streaming in; the send button turns into it.
  onStop?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const mac = useMac();

  // On this page ⌘K focuses the field; elsewhere the sidebar's Asistente
  // link takes it here.
  useEffect(() => {
    function focus(event: KeyboardEvent) {
      if (!isAssistantShortcut(event)) return;
      event.preventDefault();
      textareaRef.current?.focus();
    }
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [textareaRef]);

  function send() {
    if (draft.trim() === "" || busy || disabled) return;
    const question = draft;
    const answer = onSend(question);
    if (answer === null) return;
    setDraft("");
    answer.catch(() =>
      setDraft((current) => (current === "" ? question : current)),
    );
  }

  return (
    <form
      className="mx-auto w-full max-w-[768px]"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <InputGroup className="bg-background rounded-xl shadow-none">
        <InputGroupTextarea
          ref={textareaRef}
          value={draft}
          rows={1}
          maxLength={500}
          aria-label="Tu pregunta"
          aria-describedby={describedBy}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-[200px] min-h-[40px] resize-none overflow-y-auto p-4 text-base md:text-[13px]"
        />
        <InputGroupAddon align="block-end">
          {unitPicker}
          <InputGroupText className="ml-auto">
            <KbdGroup className="hidden gap-0.5 md:inline-flex">
              <Kbd className="border text-[10px]">{mac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd className="border text-[10px]">K</Kbd>
            </KbdGroup>
          </InputGroupText>
          <Separator
            orientation="vertical"
            className="bg-muted-foreground/20 hidden !h-4 md:block"
          />
          {busy && onStop ? (
            <InputGroupButton
              type="button"
              variant="default"
              size="icon-sm"
              className="size-7"
              onClick={onStop}
            >
              <Square className="size-3 fill-current" />
              <span className="sr-only">Detener</span>
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="size-7"
              disabled={busy || disabled || draft.trim() === ""}
            >
              <ArrowUp className="size-4" />
              <span className="sr-only">Enviar</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
