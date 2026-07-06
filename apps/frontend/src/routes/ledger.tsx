import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { motion } from "framer-motion";
import { ChevronRight, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusStamp } from "@/components/calls/StatusStamp";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCallSession } from "@/lib/call-session";
import { callSource, listCalls, type Call } from "@/lib/calls-api";
import { formatDuration, formatWhen } from "@/lib/format";
import { FACILITY_NAME } from "@/lib/config";

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

const helper = createColumnHelper<Call>();

// Module scope: stable cell components, no per-render redefinition.
const columns = [
  helper.accessor("startedAt", {
    header: "When",
    cell: (info) => (
      <span className="whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground">
        {formatWhen(info.getValue())}
      </span>
    ),
  }),
  helper.display({
    id: "from",
    header: "From",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground">
        {callSource(row.original)}
      </span>
    ),
  }),
  helper.display({
    id: "summary",
    header: "Summary",
    cell: ({ row }) => (
      <span
        className={
          row.original.status === "done"
            ? "block max-w-[420px] truncate text-[14px] font-medium text-foreground"
            : "block max-w-[420px] truncate text-[14px] text-muted-foreground"
        }
      >
        {callLine(row.original)}
      </span>
    ),
  }),
  helper.accessor("durationSeconds", {
    header: "Length",
    cell: (info) => (
      <span className="text-[12.5px] tabular-nums text-muted-foreground">
        {formatDuration(info.getValue())}
      </span>
    ),
  }),
  helper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusStamp status={info.getValue()} />,
  }),
  helper.display({
    id: "open",
    header: "",
    cell: () => <ChevronRight className="size-4 text-muted-foreground/50" />,
  }),
];

export function LedgerPage() {
  const { startCall } = useCallSession();
  const navigate = useNavigate();
  const { data: calls, isLoading } = useQuery({
    queryKey: ["calls"],
    queryFn: listCalls,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((c) => c.status === "active" || c.status === "summarizing")
        ? 3500
        : false,
    refetchOnWindowFocus: true,
  });

  const table = useReactTable({
    data: calls ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="mx-auto w-full max-w-4xl px-5 py-10 md:px-6">
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

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="mt-8 rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
        >
          {isLoading ? (
            <div className="h-64 animate-pulse" />
          ) : !calls || calls.length === 0 ? (
            <EmptyState onStart={() => void startCall()} />
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id} className="first:pl-5 last:pr-5">
                        {h.isPlaceholder
                          ? null
                          : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row, i) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.25,
                      delay: Math.min(i, 8) * 0.04,
                      ease: [0.23, 1, 0.32, 1],
                    }}
                    tabIndex={0}
                    aria-label={`Open call from ${formatWhen(row.original.startedAt)}`}
                    onClick={() =>
                      void navigate({ to: "/calls/$callId", params: { callId: row.original.id } })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        void navigate({
                          to: "/calls/$callId",
                          params: { callId: row.original.id },
                        });
                    }}
                    className="cursor-pointer border-b border-border/50 transition-colors last:border-0 pf-hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="first:pl-5 last:pr-5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          )}
        </motion.div>
      </div>
    </main>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="px-6 py-16 text-center">
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
