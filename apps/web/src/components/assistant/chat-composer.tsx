"use client";

import { ArrowUp } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const never = () => () => {};

// Whether the shortcut is ⌘K rather than Ctrl+K; the server renders Ctrl.
function useMac(): boolean {
  return useSyncExternalStore(never, isMac, () => false);
}

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
}) {
  const [draft, setDraft] = useState("");
  const mac = useMac();

  // Its own listener rather than one shared with the sidebar's ⌘B, which is
  // vendored shadcn; a third shortcut is the time for a shared hook.
  useEffect(() => {
    function focus(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== "k" || !(isMac() ? event.metaKey : event.ctrlKey)) {
        return;
      }
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
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
