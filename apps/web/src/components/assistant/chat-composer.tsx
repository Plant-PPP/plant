"use client";

import { isAssistantShortcut, useMac } from "@/lib/platform";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";

// The files a question attaches: pictures and PDFs, a few at a time, each
// small enough for the request to carry.
const ATTACH_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
];
const ATTACH_LIMIT = 4;
const ATTACH_BYTES = 2_800_000;

// Where a question is written: the field, the files it attaches, the unit the
// answer comes in, and sending. It keeps the draft, so typing re-renders only itself; ⌘K (Ctrl+K)
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
  onSend: (question: string, files: File[]) => Promise<unknown> | null;
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
  const [files, setFiles] = useState<File[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const mac = useMac();

  // Files picked, dropped or pasted: only pictures and PDFs, small enough,
  // a few a question.
  function attach(picked: readonly File[]) {
    const taken = picked.filter(
      (file) => ATTACH_TYPES.includes(file.type) && file.size <= ATTACH_BYTES,
    );
    if (taken.length < picked.length) {
      toast.error("Adjuntá imágenes o PDFs de hasta 2,8 MB.");
    }
    setFiles((current) => [...current, ...taken].slice(0, ATTACH_LIMIT));
  }

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
    if ((draft.trim() === "" && files.length === 0) || busy || disabled) {
      return;
    }
    const question = draft;
    const sent = files;
    const answer = onSend(question, sent);
    if (answer === null) return;
    setDraft("");
    setFiles([]);
    answer.catch(() => {
      setDraft((current) => (current === "" ? question : current));
      setFiles((current) => (current.length === 0 ? sent : current));
    });
  }

  return (
    <form
      className="mx-auto w-full max-w-[768px]"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        attach([...event.dataTransfer.files]);
      }}
    >
      <input
        ref={picker}
        type="file"
        accept={ATTACH_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          attach([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="bg-muted flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
            >
              <Paperclip aria-hidden className="size-3" />
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Sacar ${file.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setFiles((current) => current.filter((_, at) => at !== index))
                }
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
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
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (pasted.length === 0) return;
            event.preventDefault();
            attach(pasted);
          }}
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
          <InputGroupButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7"
            disabled={disabled || files.length >= ATTACH_LIMIT}
            onClick={() => picker.current?.click()}
          >
            <Paperclip className="size-4" />
            <span className="sr-only">Adjuntar archivos</span>
          </InputGroupButton>
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
              disabled={
                busy || disabled || (draft.trim() === "" && files.length === 0)
              }
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
