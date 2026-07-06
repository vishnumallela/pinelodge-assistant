import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";

import { ConsoleView } from "@/components/voice/ConsoleView";
import { StatusStamp } from "@/components/calls/StatusStamp";
import { Spinner } from "@/components/ui/spinner";
import { useCallSession } from "@/lib/call-session";
import { callSource, orpc, type Call } from "@/lib/orpc";
import { formatDuration, formatWhen } from "@/lib/format";
import { AGENT_NAME } from "@/lib/receptionist-agent";

export function CallPage() {
  const { callId } = useParams({ from: "/app/calls/$callId" });
  const { activeCallId } = useCallSession();

  // The one call being conducted right now renders the live console. Every
  // other call is a locked, written-up record.
  if (callId === activeCallId) return <ConsoleView />;
  return <LockedCall callId={callId} />;
}

function LockedCall({ callId }: { callId: string }) {
  const { data: call, isLoading } = useQuery(
    orpc.calls.get.queryOptions({
      input: { id: callId },
      refetchInterval: (q) => (q.state.data?.status === "summarizing" ? 2500 : false),
    }),
  );

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors pf-hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Call log
        </Link>

        {isLoading || !call ? (
          <div className="mt-6 h-64 animate-pulse rounded-2xl border border-border/60 bg-card/60" />
        ) : (
          <>
            <header className="mt-5 flex items-end justify-between gap-4">
              <div className="space-y-1">
                <h1 className="font-display text-[28px] leading-none text-foreground">
                  {formatWhen(call.startedAt)}
                </h1>
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Lock className="size-3" /> Locked · {callSource(call)} ·{" "}
                  {formatDuration(call.durationSeconds)}
                </p>
              </div>
              <StatusStamp status={call.status} />
            </header>

            <SummaryCard call={call} />
            <Transcript call={call} />
            <EventTimeline call={call} />
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCard({ call }: { call: Call }) {
  return (
    <section className="mt-6 rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(33,28,24,0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-brand" aria-hidden />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Front desk summary
        </h2>
      </div>

      {call.status === "summarizing" ? (
        <div className="flex items-center gap-3 py-6 text-[14px] text-muted-foreground">
          <Spinner /> {AGENT_NAME} is writing up the call…
        </div>
      ) : call.status === "failed" || !call.summary ? (
        <p className="py-4 text-[14px] text-muted-foreground">
          The summary couldn&rsquo;t be generated for this call. The transcript is below.
        </p>
      ) : (
        <div className="space-y-5">
          <p className="text-pretty text-[17px] font-medium leading-snug text-foreground">
            {call.summary.headline}
          </p>
          <Field label="Caller">{call.summary.caller}</Field>
          <Field label="Key points">
            <ul className="space-y-1.5">
              {call.summary.keyPoints.map((p, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-foreground">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-brand/60" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Outcome">{call.summary.outcome}</Field>
            <Field label="Follow-up">{call.summary.followUp}</Field>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <div className="text-[14px] leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function Transcript({ call }: { call: Call }) {
  if (call.transcript.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Transcript
      </h2>
      <div className="space-y-3">
        {call.transcript.map((turn, i) => {
          const isAgent = turn.role === "assistant";
          return (
            <div key={i} className="grid grid-cols-[64px_1fr] gap-3">
              <span
                className={`pt-0.5 text-[12px] font-medium ${isAgent ? "text-brand" : "text-muted-foreground"}`}
              >
                {isAgent ? AGENT_NAME : "Caller"}
              </span>
              <p className="text-pretty text-[14px] leading-relaxed text-foreground">{turn.text}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EventTimeline({ call }: { call: Call }) {
  if (call.events.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        System events
      </h2>
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <ol className="space-y-1.5">
          {call.events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="grid grid-cols-[76px_1fr] gap-3 text-[12.5px]">
              <span className="whitespace-nowrap tabular-nums text-muted-foreground/70">
                {new Date(e.at).toLocaleTimeString("en-US", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span className="text-foreground">
                {e.event}
                {e.detail && <span className="text-muted-foreground"> · {e.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
