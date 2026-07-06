import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusStamp } from "@/components/calls/StatusStamp";
import { useCallSession } from "@/lib/call-session";
import { listCalls, type Call } from "@/lib/calls-api";
import { formatDuration, formatWhen } from "@/lib/format";
import { FACILITY_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";

/** One line describing a call, keyed off its status. */
function callLine(call: Call): string {
  if (call.summary?.headline) return call.summary.headline;
  switch (call.status) {
    case "active":
      return "Call in progress…";
    case "summarizing":
      return "Writing up the summary…";
    case "failed":
      return "The summary couldn't be generated.";
    default:
      return "No summary available.";
  }
}

export function LedgerPage() {
  const { startCall } = useCallSession();
  const { data: calls, isLoading } = useQuery({
    queryKey: ["calls"],
    queryFn: listCalls,
    // Keep the log fresh while any call is live or being written up.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((c) => c.status === "active" || c.status === "summarizing")
        ? 3500
        : false,
    refetchOnWindowFocus: true,
  });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="mx-auto w-full max-w-3xl px-5 py-10 md:px-6">
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-none tracking-normal text-foreground">
              Call log
            </h1>
            <p className="text-[14px] text-muted-foreground">
              Every call to {FACILITY_NAME}, written up when it ends.
            </p>
          </div>
          <Button
            onClick={() => void startCall()}
            className="bg-brand text-brand-foreground shadow-[0_1px_2px_rgba(154,106,47,0.25)] pf-hover:bg-brand/90"
          >
            <Phone className="size-4" /> New call
          </Button>
        </header>

        <div className="mt-8">
          {isLoading ? (
            <LedgerSkeleton />
          ) : !calls || calls.length === 0 ? (
            <EmptyState onStart={() => void startCall()} />
          ) : (
            <ul className="space-y-1.5">
              {calls.map((call) => (
                <li key={call.id}>
                  <CallRow call={call} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function CallRow({ call }: { call: Call }) {
  const done = call.status === "done";
  return (
    <Link
      to="/calls/$callId"
      params={{ callId: call.id }}
      className={cn(
        "group grid grid-cols-[128px_1fr_auto] items-center gap-4 rounded-xl border border-border/70 bg-card px-5 py-3.5",
        "transition-[background-color,border-color,transform] duration-150 [transition-timing-function:var(--ease-out)]",
        "pf-hover:border-border pf-hover:bg-accent/40 active:scale-[0.997]",
      )}
    >
      <span className="text-[12.5px] tabular-nums text-muted-foreground">
        {formatWhen(call.startedAt)}
      </span>
      <span
        className={cn(
          "truncate text-[14px]",
          done ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {callLine(call)}
      </span>
      <span className="flex items-center gap-4">
        <span className="hidden w-14 text-right text-[12.5px] tabular-nums text-muted-foreground sm:inline">
          {formatDuration(call.durationSeconds)}
        </span>
        <StatusStamp status={call.status} className="w-[104px] justify-end" />
        <ChevronRight className="size-4 text-muted-foreground/50 transition-transform duration-150 group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <p className="font-display text-[24px] leading-tight text-foreground">The log is empty</p>
      <p className="mx-auto mt-1.5 max-w-sm text-pretty text-[14px] text-muted-foreground">
        Place a call to the front desk and it&rsquo;ll be logged here with a written summary once it
        ends.
      </p>
      <Button
        onClick={onStart}
        className="mt-6 bg-brand text-brand-foreground pf-hover:bg-brand/90"
      >
        <Phone className="size-4" /> Start the first call
      </Button>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <ul className="space-y-1.5">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-[58px] animate-pulse rounded-xl border border-border/60 bg-card/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </ul>
  );
}
