import { Link } from "@tanstack/react-router";
import type { LiveCall } from "@/lib/call-session";
import { formatDuration, labelize } from "@/lib/format";

/**
 * Live structured call state, read back from the server as Sarah's tools
 * persist it. Presentation only — the values come from the call record.
 */
export function CallStatePanel({ call }: { call: LiveCall }) {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-7 overflow-y-auto border-l border-border/60 bg-sidebar/50 px-6 py-6">
      <Section title="Call">
        <Row
          label="Screening"
          value={labelize(call.screening === "pending" ? null : call.screening)}
        />
        <Row
          label="Duration"
          value={
            call.durationSeconds != null ? formatDuration(call.durationSeconds) : "In progress"
          }
        />
      </Section>

      <Section title="Caller">
        <Row label="Name" value={call.callerName} />
        <Row label="Callback" value={call.callerPhone} />
        <Row label="Reason" value={call.reason} />
        <Row label="Resident" value={call.residentName} />
        <Row label="Relationship" value={call.relationship} />
        <Row label="Callback time" value={call.callbackTime} />
        <Row label="Urgency" value={labelize(call.urgency)} />
      </Section>

      <Section title="Routing">
        <Row label="Intent" value={labelize(call.routeTarget)} />
        <Row label="Destination" value={call.destinationName} />
        <Row label="Outcome" value={labelize(call.transferOutcome)} />
      </Section>

      {call.voicemail && (
        <Section title="Voicemail">
          <p className="rounded-lg bg-muted px-3 py-2.5 text-sm leading-6 text-foreground">
            {call.voicemail}
          </p>
        </Section>
      )}

      {call.status === "completed" && (
        <Link
          to="/calls/$callId"
          params={{ callId: call.id }}
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          View call report
        </Link>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const has = Boolean(value?.trim());
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={has ? "truncate text-right text-foreground" : "text-right text-border"}
        title={value ?? undefined}
      >
        {has ? value : "—"}
      </span>
    </div>
  );
}
