import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Inbox, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { callSource, orpc, type MessageCall } from "@/lib/orpc";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

/**
 * The after-hours inbox: every message-only call across ALL centers in one
 * place, so whoever opens up in the morning (Dessa) reviews and triages both
 * facilities without switching the center dropdown.
 */

function messageLine(call: MessageCall): string {
  if (call.summary?.headline) return call.summary.headline;
  const lastCaller = call.transcript.toReversed().find((t) => t.role === "caller");
  if (lastCaller) return lastCaller.text;
  if (call.status === "active") return "Call in progress…";
  return "No message content.";
}

export function MessagesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [onlyOpen, setOnlyOpen] = useState(true);

  const { data, isLoading } = useQuery(
    orpc.messages.list.queryOptions({
      input: { page, pageSize: PAGE_SIZE, onlyOpen },
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: true,
    }),
  );

  const triage = useMutation(
    orpc.messages.setTriage.mutationOptions({
      onSuccess: (_d, vars) => {
        void qc.invalidateQueries({ queryKey: orpc.messages.list.key() });
        toast.success(vars.triage === "done" ? "Marked done." : "Reopened.");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const messages = data?.calls ?? [];
  const total = data?.total ?? 0;
  const openCount = data?.openCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="w-full px-5 py-10 md:px-8">
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-none text-foreground">Messages</h1>
            <p className="text-[14px] text-muted-foreground">
              After-hours messages from every center, ready for morning triage.
              {openCount > 0 && ` ${openCount} open.`}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card p-1">
            {(["Open", "All"] as const).map((tab) => {
              const active = onlyOpen === (tab === "Open");
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setOnlyOpen(tab === "Open");
                    setPage(1);
                  }}
                  className={cn(
                    "tap rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground pf-hover:text-foreground",
                  )}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="mt-8 rounded-2xl border border-border/70 bg-card shadow-card"
        >
          {isLoading ? (
            <div className="m-5 h-56 animate-pulse rounded-xl bg-secondary/60" />
          ) : messages.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Inbox className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-3 font-display text-[22px] leading-tight text-foreground">
                {onlyOpen ? "Nothing to triage" : "No messages yet"}
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-[14px] text-muted-foreground">
                After-hours calls land here as messages once a center's cutoff is enabled in its
                editor.
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-px whitespace-nowrap pl-5">When</TableHead>
                    <TableHead className="w-px whitespace-nowrap">Center</TableHead>
                    <TableHead className="w-px whitespace-nowrap">From</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-px whitespace-nowrap">Status</TableHead>
                    <TableHead className="w-px whitespace-nowrap pr-5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((m, i) => (
                    <motion.tr
                      key={m.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.25,
                        delay: Math.min(i, 8) * 0.03,
                        ease: [0.23, 1, 0.32, 1],
                      }}
                      tabIndex={0}
                      onClick={() =>
                        void navigate({ to: "/calls/$callId", params: { callId: m.id } })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          void navigate({ to: "/calls/$callId", params: { callId: m.id } });
                      }}
                      className="cursor-pointer border-b border-border/50 transition-colors last:border-0 pf-hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                    >
                      <TableCell className="whitespace-nowrap pl-5 text-[12.5px] text-muted-foreground">
                        {formatWhen(m.startedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12.5px] text-foreground">
                        {m.centerName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12.5px] text-muted-foreground">
                        {callSource(m)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "block max-w-105 truncate text-[14px]",
                            m.triage === "open"
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {messageLine(m)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {m.triage === "open" ? (
                          <Badge variant="outline">Open</Badge>
                        ) : (
                          <Badge variant="success">Done</Badge>
                        )}
                      </TableCell>
                      <TableCell className="pr-5">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={triage.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            triage.mutate({
                              id: m.id,
                              triage: m.triage === "open" ? "done" : "open",
                            });
                          }}
                        >
                          {m.triage === "open" ? (
                            <>
                              <Check className="size-3.5" /> Done
                            </>
                          ) : (
                            <>
                              <RotateCcw className="size-3.5" /> Reopen
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
              {pageCount > 1 && (
                <div className="flex items-center justify-end gap-1.5 border-t border-border/60 px-5 py-3">
                  <span className="mr-2 text-[12.5px] text-muted-foreground">
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
              )}
            </>
          )}
        </motion.div>
      </div>
    </main>
  );
}
