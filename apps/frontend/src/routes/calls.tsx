import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { Page } from "@/components/layout/Page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatDuration, labelize } from "@/lib/format";

export function CallsPage() {
  const { data: calls = [], isPending } = useQuery(orpc.calls.list.queryOptions());

  return (
    <Page title="Calls" description="Every incoming call, its routing decision, and its report.">
      {isPending ? (
        <div className="flex flex-col gap-3 pt-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No calls yet. Start one from the console and it will appear here.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead className="hidden md:table-cell">Reason</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="text-right">Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c) => (
              <TableRow key={c.id} className="relative cursor-pointer">
                <TableCell className="whitespace-nowrap">
                  <Link
                    to="/calls/$callId"
                    params={{ callId: c.id }}
                    className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {formatDateTime(c.startedAt)}
                  </Link>
                </TableCell>
                <TableCell className="font-medium">{c.callerName?.trim() || "Unknown"}</TableCell>
                <TableCell className="hidden max-w-[28ch] truncate text-muted-foreground md:table-cell">
                  {c.reason ?? "—"}
                </TableCell>
                <TableCell>{c.destinationName ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.status === "active" ? "In progress" : labelize(c.transferOutcome)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatDuration(c.durationSeconds)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
