import { useEffect, useState } from "react";
import type { LiveCall } from "@/lib/call-session";
import { labelize } from "@/lib/format";

function tickingDuration(startedAtIso: string): string {
  const started = new Date(startedAtIso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Slim status bar above the live transcript: who is calling, for how long,
 *  and where screening/routing currently stand. */
export function CallHeader({ call, connected }: { call: LiveCall; connected: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [connected]);

  const facts = [
    call.callerName?.trim() || "Unknown caller",
    connected ? tickingDuration(call.startedAt) : "Ended",
    call.screening !== "pending" ? labelize(call.screening) : null,
    call.destinationName ? `To ${call.destinationName}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex h-11 shrink-0 items-center justify-center gap-3 border-b border-border/60 px-4 text-[13px] text-muted-foreground">
      {connected && (
        <span className="relative flex h-2 w-2" aria-label="Live">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
      )}
      {facts.map((f, i) => (
        <span key={f} className="flex items-center gap-3">
          {i > 0 && <span className="h-3 w-px bg-border" aria-hidden />}
          <span className={i === 0 ? "font-medium text-foreground" : "tabular-nums"}>{f}</span>
        </span>
      ))}
    </div>
  );
}
