import { cn } from "@/lib/utils";
import type { CallStatus } from "@/lib/orpc";

/**
 * The status stamp on a call slip. Brass = live, sage = summarized, muted =
 * being written up, warm red = failed. A stamp, not a candy pill: quiet chip,
 * a single dot carrying the color.
 */

const META: Record<CallStatus, { label: string; dot: string; text: string; pulse?: boolean }> = {
  active: { label: "Live", dot: "bg-brand", text: "text-brand", pulse: true },
  summarizing: { label: "Writing up", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  done: { label: "Summarized", dot: "bg-success", text: "text-success" },
  failed: { label: "Summary failed", dot: "bg-destructive", text: "text-destructive" },
};

export function StatusStamp({ status, className }: { status: CallStatus; className?: string }) {
  const m = META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-medium tabular-nums",
        m.text,
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          m.dot,
          m.pulse && "motion-safe:animate-[live-pulse_1.8s_ease-out_infinite]",
        )}
        aria-hidden
      />
      {m.label}
    </span>
  );
}
