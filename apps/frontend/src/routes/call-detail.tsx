import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { Page } from "@/components/layout/Page";
import { formatDateTime, formatDuration, labelize } from "@/lib/format";

export function CallDetailPage() {
  const { callId } = useParams({ from: "/app/calls/$callId" });
  const { data: call, isPending } = useQuery(
    orpc.calls.get.queryOptions({
      input: { callId },
      // Poll briefly while the async report job runs.
      refetchInterval: (q) => (q.state.data?.summaryStatus === "pending" ? 3000 : false),
    }),
  );

  if (isPending) {
    return (
      <Page title="Call">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Page>
    );
  }
  if (!call) {
    return (
      <Page title="Call not found">
        <Link to="/calls" className="text-sm font-medium underline-offset-4 hover:underline">
          Back to calls
        </Link>
      </Page>
    );
  }

  return (
    <Page
      title={call.callerName?.trim() || "Unknown caller"}
      description={`${formatDateTime(call.startedAt)} · ${formatDuration(call.durationSeconds)}`}
    >
      <div className="flex flex-col gap-10">
        <section className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-3">
          <Fact label="Screening" value={labelize(call.screening)} />
          <Fact label="Intent" value={labelize(call.routeTarget)} />
          <Fact label="Destination" value={call.destinationName ?? "—"} />
          <Fact
            label="Outcome"
            value={call.status === "active" ? "In progress" : labelize(call.transferOutcome)}
          />
          <Fact label="Callback" value={call.callerPhone ?? "—"} />
          <Fact label="Urgency" value={labelize(call.urgency)} />
          <Fact label="Resident" value={call.residentName ?? "—"} />
          <Fact label="Relationship" value={call.relationship ?? "—"} />
          <Fact label="Callback time" value={call.callbackTime ?? "—"} />
        </section>

        {call.reason && (
          <Section title="Reason for calling">
            <p className="text-sm leading-6">{call.reason}</p>
          </Section>
        )}

        {call.voicemail && (
          <Section title="Voicemail">
            <p className="whitespace-pre-wrap text-sm leading-6">{call.voicemail}</p>
          </Section>
        )}

        <Section title="Call report">
          {call.report ? (
            <dl className="flex flex-col gap-4">
              <Report label="Executive summary" value={call.report.executiveSummary} />
              <Report label="Caller intent" value={call.report.callerIntent} />
              <Report label="Information collected" value={call.report.informationCollected} />
              <Report label="Routing decision" value={call.report.routingDecision} />
              <Report label="Follow-up" value={call.report.followUp} />
              <Report label="Final disposition" value={call.report.finalDisposition} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              {call.summaryStatus === "pending"
                ? "The report is being written…"
                : call.summaryStatus === "failed"
                  ? "Report generation failed."
                  : call.status === "active"
                    ? "The report is written after the call ends."
                    : "No report yet."}
            </p>
          )}
        </Section>

        <Section title="Transcript">
          {call.transcript.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transcript was captured.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {call.transcript.map((t) => (
                <li key={t.entryId} className="text-sm leading-6">
                  <span className="font-medium">{t.role === "assistant" ? "Sarah" : "Caller"}</span>
                  <span className="text-muted-foreground"> · </span>
                  {t.text}
                </li>
              ))}
            </ol>
          )}
        </Section>

        {call.toolEvents.length > 0 && (
          <Section title="Tools executed">
            <ol className="flex flex-col gap-1.5">
              {call.toolEvents.map((t, i) => (
                <li key={`${t.name}-${i}`} className="text-sm text-muted-foreground">
                  <span className="font-mono text-[13px] text-foreground">{t.name}</span>
                  {" · "}
                  {formatDateTime(t.at)}
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function Report({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-6">{value}</dd>
    </div>
  );
}
