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
import { ChevronRight, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { PageShell } from "@/components/layout/PageShell";
import { cardEntrance, rowEntrance } from "@/lib/motion";
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
    <PageShell
      title="Call log"
      subtitle={`Every call to ${center?.name ?? "this center"}, written up when it ends.`}
      action={
        <Button
          onClick={() => void startCall()}
          variant="brand"
          className="shadow-[0_1px_2px_rgba(154,106,47,0.25)]"
        >
          <Phone className="size-4" /> New call
        </Button>
      }
    >
      <motion.div
        {...cardEntrance}
        className="mt-8 rounded-2xl border border-border/70 bg-card shadow-card"
      >
        {isLoading || centerId === "" ? (
          <div className="m-5 h-56 animate-pulse rounded-xl bg-secondary/60" />
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
                    {...rowEntrance(i)}
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

            <Pager
              page={page}
              pageCount={pageCount}
              onPage={setPage}
              label={`${from}–${to} of ${total} calls`}
            />
          </>
        )}
      </motion.div>
    </PageShell>
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
      <Button onClick={onStart} variant="brand" className="mt-6">
        <Phone className="size-4" /> Start the first call
      </Button>
    </div>
  );
}
