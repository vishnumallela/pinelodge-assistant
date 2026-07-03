import { memo, useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  Check,
  Copy,
  Info,
  NotebookPen,
  PhoneForwarded,
  PhoneOff,
  ShieldCheck,
  Voicemail,
  type LucideIcon,
} from "lucide-react";
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

/** Presentation for each tool the assistant can run mid-call. */
const TOOL_META: Record<string, { running: string; done: string; icon: LucideIcon }> = {
  get_facility_info: {
    running: "Looking up community info",
    done: "Looked up community info",
    icon: Info,
  },
  screen_call: { running: "Screening the call", done: "Call screened", icon: ShieldCheck },
  save_caller_info: {
    running: "Noting caller details",
    done: "Caller details saved",
    icon: NotebookPen,
  },
  check_availability: {
    running: "Checking the schedule",
    done: "Schedule checked",
    icon: CalendarClock,
  },
  route_call: { running: "Routing the call", done: "Call routed", icon: ArrowRightLeft },
  complete_transfer: {
    running: "Transferring the line",
    done: "Line transferred",
    icon: PhoneForwarded,
  },
  leave_voicemail: { running: "Saving the voicemail", done: "Voicemail saved", icon: Voicemail },
  end_call: { running: "Ending the call", done: "Call ended", icon: PhoneOff },
};

/**
 * The live conversation: completed turns interleaved with the tool activity
 * that produced them, plus the assistant's speaking/thinking state. Built on
 * the shadcn conversation primitives — Message/Bubble for turns, Marker for
 * inline activity, MessageScroller for live-edge scrolling.
 */
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
            {items.map((item) =>
              item.kind === "message" ? (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  scrollAnchor={item.role === "user"}
                >
                  <Turn from={item.role} text={item.text} />
                </MessageScrollerItem>
              ) : (
                <MessageScrollerItem key={item.id} messageId={item.id}>
                  <ToolMarker name={item.name} status={item.status} />
                </MessageScrollerItem>
              ),
            )}
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

const ToolMarker = memo(function ToolMarker({
  name,
  status,
}: {
  name: string;
  status: "running" | "done";
}) {
  const meta = TOOL_META[name];
  const label = meta ? (status === "running" ? meta.running : meta.done) : name;
  const Icon = meta?.icon ?? Info;
  return (
    <Marker
      role={status === "running" ? "status" : undefined}
      className="[animation:message-in_0.28s_var(--ease-out)]"
    >
      <MarkerIcon>{status === "running" ? <Spinner /> : <Icon className="size-3.5" />}</MarkerIcon>
      <MarkerContent className={status === "running" ? "shimmer" : undefined}>
        {status === "running" ? <>{label}&hellip;</> : label}
      </MarkerContent>
    </Marker>
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
