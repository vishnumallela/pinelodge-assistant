import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Phone } from "lucide-react";

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
import { useCenter } from "@/lib/center";
import { callSource, orpc, type Call } from "@/lib/orpc";
import { formatDuration, formatWhen } from "@/lib/format";

const PAGE_SIZE = 20;

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

// The "w-px whitespace-nowrap" columns shrink to content; Summary flexes to
// fill the rest of the row, so the table uses the full width.
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
            ? "block truncate text-[14px] font-medium text-foreground"
            : "block truncate text-[14px] text-muted-foreground"
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

const SHRINK = new Set(["startedAt", "from", "durationSeconds", "status", "open"]);

export function LedgerPage() {
  const { startCall } = useCallSession();
  const { center, centerId } = useCenter();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery(
    orpc.calls.list.queryOptions({
      input: { centerId, page, pageSize: PAGE_SIZE },
      enabled: centerId !== "",
      placeholderData: keepPreviousData,
      refetchInterval: (q) =>
        (q.state.data?.calls ?? []).some((c) => c.status === "active" || c.status === "summarizing")
          ? 3500
          : false,
      refetchOnWindowFocus: true,
    }),
  );

  const calls = data?.calls ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const table = useReactTable({
    data: calls,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount,
  });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="w-full px-5 py-10 md:px-8">
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-none tracking-normal text-foreground">
              Call log
            </h1>
            <p className="text-[14px] text-muted-foreground">
              Every call to {center?.name ?? "this center"}, written up when it ends.
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
          {isLoading || centerId === "" ? (
            <div className="h-64 animate-pulse" />
          ) : calls.length === 0 ? (
            <EmptyState onStart={() => void startCall()} />
          ) : (
            <>
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id}>
                      {hg.headers.map((h) => (
                        <TableHead
                          key={h.id}
                          className={`first:pl-5 last:pr-5 ${SHRINK.has(h.column.id) ? "w-px whitespace-nowrap" : ""}`}
                        >
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
                        delay: Math.min(i, 8) * 0.03,
                        ease: [0.23, 1, 0.32, 1],
                      }}
                      tabIndex={0}
                      aria-label={`Open call from ${formatWhen(row.original.startedAt)}`}
                      onClick={() =>
                        void navigate({
                          to: "/calls/$callId",
                          params: { callId: row.original.id },
                        })
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
                        <TableCell
                          key={cell.id}
                          className={`first:pl-5 last:pr-5 ${SHRINK.has(cell.column.id) ? "w-px whitespace-nowrap" : ""}`}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
                <span className="text-[12.5px] tabular-nums text-muted-foreground">
                  {from}&ndash;{to} of {total} calls
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="mr-2 text-[12.5px] tabular-nums text-muted-foreground">
                    Page {page} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous page"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next page"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
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
