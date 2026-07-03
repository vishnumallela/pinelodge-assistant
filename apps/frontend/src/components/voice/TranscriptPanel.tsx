import { memo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

/**
 * The conversation transcript, built on MessageScroller: each user turn is a
 * scroll anchor so a new exchange starts near the top of the viewport, streams
 * grow into the screen while the reader is at the live edge, and reopening a
 * saved call lands on the last meaningful turn instead of the absolute bottom.
 */
export function TranscriptPanel({
  messages,
  liveUserText,
  liveAgentText,
  thinking,
  className,
}: {
  messages: TranscriptMessage[];
  liveUserText?: string;
  liveAgentText?: string;
  thinking?: boolean;
  className?: string;
}) {
  const streaming = Boolean(liveAgentText) || Boolean(thinking);
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={56}
    >
      <MessageScroller className={className} style={{ viewTransitionName: "transcript" }}>
        <MessageScrollerViewport className="scrollbar-subtle">
          <MessageScrollerContent
            aria-busy={streaming}
            className="mx-auto w-full max-w-3xl gap-4 px-4 pb-40 pt-5 md:px-5"
          >
            {messages.map((m) => (
              <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                <Row from={m.role} text={m.text} />
              </MessageScrollerItem>
            ))}
            {liveUserText ? (
              <MessageScrollerItem messageId="live-user">
                <Row from="user" text={liveUserText} pending />
              </MessageScrollerItem>
            ) : null}
            {liveAgentText ? (
              <MessageScrollerItem messageId="live-agent">
                <Row from="assistant" text={liveAgentText} pending />
              </MessageScrollerItem>
            ) : null}
            {thinking && !liveAgentText ? (
              <MessageScrollerItem messageId="thinking">
                <ThinkingDots />
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="bottom-36" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

const Row = memo(function Row({
  from,
  text,
  pending,
}: {
  from: "user" | "assistant";
  text: string;
  pending?: boolean;
}) {
  const isUser = from === "user";
  return (
    <Message
      align={isUser ? "end" : "start"}
      className={cn(
        "group/message [animation:message-in_0.28s_var(--ease-out)]",
        pending && "opacity-60",
      )}
    >
      <MessageContent>
        <div
          className={cn(
            "whitespace-pre-wrap text-[15.5px] leading-7 text-foreground",
            isUser
              ? "ml-auto w-fit max-w-[75%] rounded-3xl bg-accent px-4 py-2.5"
              : "max-w-[68ch] text-pretty",
          )}
        >
          {text}
        </div>
        {!isUser && !pending && <CopyButton text={text} />}
      </MessageContent>
    </Message>
  );
});

function ThinkingDots() {
  return (
    <Message align="start">
      <MessageContent>
        <output aria-label="Thinking" className="flex items-center gap-1 py-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
              style={{ animation: `pinelodge-dot 1.2s ease-in-out ${i * 0.16}s infinite` }}
            />
          ))}
        </output>
      </MessageContent>
    </Message>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
      aria-label="Copy message"
      className="relative mt-1 grid size-8 place-items-center rounded-lg text-muted-foreground opacity-0 transition-[opacity,transform,scale,background-color,color] before:absolute before:-inset-1 active:scale-[0.96] pf-hover:bg-accent pf-hover:text-foreground group-hover/message:opacity-100 [@media(hover:none)]:opacity-100"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
