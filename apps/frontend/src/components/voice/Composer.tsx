import { useState } from "react";
import { ArrowUp, Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function Composer({
  connected,
  connecting,
  muted,
  canSend,
  placeholder = "Respond as the caller",
  onSend,
  onStart,
  onEnd,
  onToggleMute,
}: {
  connected: boolean;
  connecting: boolean;
  muted: boolean;
  canSend: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onStart: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}) {
  const [text, setText] = useState("");

  function submit() {
    const t = text.trim();
    if (!t || !canSend) return;
    onSend(t);
    setText("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const hint = canSend
    ? placeholder
    : connected
      ? "You're viewing a past conversation."
      : "Start a call to talk, or type a message once you're connected.";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 rounded-[28px] border border-border bg-background p-2 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-colors focus-within:border-foreground/25"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={hint}
        disabled={!canSend}
        aria-label="Message"
        rows={1}
        className="field-sizing-content max-h-[50dvh] min-w-0 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      <div className="flex items-center gap-1">
        {connected ? (
          <>
            <IconButton onClick={onToggleMute} label={muted ? "Unmute" : "Mute"}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </IconButton>
            <IconButton onClick={onEnd} label="End call" danger>
              <PhoneOff className="h-4 w-4" />
            </IconButton>
            <button
              type="submit"
              disabled={!canSend || !text.trim()}
              aria-label="Send"
              className="tap grid size-10 place-items-center rounded-full bg-foreground text-background transition-[transform,scale,background-color,color] active:scale-[0.96] disabled:bg-disabled disabled:text-disabled-foreground"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </>
        ) : connecting ? (
          <span className="grid size-10 place-items-center rounded-full bg-foreground text-background">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        ) : (
          <button
            type="button"
            onClick={onStart}
            aria-label="Start call"
            className="tap grid size-10 place-items-center rounded-full bg-foreground text-background transition-[transform,scale] active:scale-[0.96]"
          >
            <Phone className="h-4 w-4" />
          </button>
        )}
      </div>
    </form>
  );
}

function IconButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "tap grid size-10 place-items-center rounded-full text-muted-foreground transition-[transform,scale,background-color,color] active:scale-[0.96]",
        danger
          ? "pf-hover:bg-destructive/10 pf-hover:text-destructive"
          : "pf-hover:bg-accent pf-hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
