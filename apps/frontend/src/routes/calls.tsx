import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { Page } from "@/components/layout/Page";
import { formatDateTime, formatDuration, labelize } from "@/lib/format";

export function CallsPage() {
  const { data: calls = [] } = useQuery(orpc.calls.list.queryOptions());

  return (
    <Page title="Calls" description="Every incoming call, its routing decision, and its report.">
      {calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No calls yet. Start one from the console and it will appear here.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Time</th>
              <th className="py-2 pr-4 font-medium">Caller</th>
              <th className="hidden py-2 pr-4 font-medium md:table-cell">Reason</th>
              <th className="py-2 pr-4 font-medium">Destination</th>
              <th className="py-2 pr-4 font-medium">Outcome</th>
              <th className="py-2 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className="group relative border-b border-border/60">
                <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">
                  <Link
                    to="/calls/$callId"
                    params={{ callId: c.id }}
                    className="text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formatDateTime(c.startedAt)}
                  </Link>
                </td>
                <td className="py-3 pr-4">{c.callerName?.trim() || "Unknown"}</td>
                <td className="hidden max-w-[28ch] truncate py-3 pr-4 text-muted-foreground md:table-cell">
                  {c.reason ?? "—"}
                </td>
                <td className="py-3 pr-4">{c.destinationName ?? "—"}</td>
                <td className="py-3 pr-4 text-muted-foreground">
                  {c.status === "active" ? "In progress" : labelize(c.transferOutcome)}
                </td>
                <td className="py-3 text-right tabular-nums text-muted-foreground">
                  {formatDuration(c.durationSeconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
