import { memo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import type { FeedItem } from "@/lib/call-session";

export function TranscriptPanel({
  items,
  agentName,
  speaking,
  thinking,
  className,
}: {
  items: FeedItem[];
  agentName: string;
  speaking?: boolean;
  thinking?: boolean;
  className?: string;
}) {
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={56}
    >
      <MessageScroller className={className} style={{ viewTransitionName: "transcript" }}>
        <MessageScrollerViewport className="scrollbar-subtle">
          <MessageScrollerContent
            aria-busy={Boolean(speaking || thinking)}
            className="mx-auto w-full max-w-3xl gap-4 px-4 pb-40 pt-6 md:px-5"
          >
            {items.map((item) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={item.role === "user"}
              >
                <Turn from={item.role} text={item.text} />
              </MessageScrollerItem>
            ))}
            {speaking ? (
              <MessageScrollerItem messageId="speaking">
                <Marker role="status" className="[animation:message-in_0.28s_var(--ease-out)]">
                  <MarkerIcon>
                    <SpeakingBars />
                  </MarkerIcon>
                  <MarkerContent className="shimmer">{agentName} is speaking&hellip;</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : thinking ? (
              <MessageScrollerItem messageId="thinking">
                <Marker role="status" className="[animation:message-in_0.28s_var(--ease-out)]">
                  <MarkerIcon>
                    <Spinner />
                  </MarkerIcon>
                  <MarkerContent className="shimmer">Thinking&hellip;</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="bottom-36" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

const Turn = memo(function Turn({ from, text }: { from: "user" | "assistant"; text: string }) {
  if (from === "user") {
    return (
      <Message align="end" className="[animation:message-in_0.28s_var(--ease-out)]">
        <MessageContent>
          <Bubble variant="muted">
            <BubbleContent className="whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-[15px] leading-7">
              {text}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  return (
    <Message align="start" className="[animation:message-in_0.28s_var(--ease-out)]">
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent className="max-w-[68ch] whitespace-pre-wrap text-pretty text-[15.5px] leading-7 text-foreground">
            {text}
          </BubbleContent>
        </Bubble>
        <MessageFooter className="opacity-0 transition-opacity group-hover/message:opacity-100 [@media(hover:none)]:opacity-100">
          <CopyButton text={text} />
        </MessageFooter>
      </MessageContent>
    </Message>
  );
});

function SpeakingBars() {
  return (
    <span className="flex size-4 items-end justify-center gap-[2.5px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-muted-foreground"
          style={{
            height: "11px",
            animation: `pinelodge-bar 1s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Copy message"
      className="size-7 rounded-lg text-muted-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}
