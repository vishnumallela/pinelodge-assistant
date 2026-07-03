import { lazy, memo, Suspense } from "react";
import { m, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { AgentState } from "@/components/ui/orb";

const Orb = lazy(() => import("@/components/ui/orb").then((mod) => ({ default: mod.Orb })));

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const WRAP = { lg: "h-44 w-44", sm: "h-11 w-11" } as const;

const ORB_COLORS: [string, string] = ["#CADCFC", "#A0B9D1"];

const ORB_FALLBACK = <span className="block h-full w-full rounded-full bg-foreground/10" />;

export const VoiceOrb = memo(function VoiceOrb({
  state,
  size = "lg",
}: {
  state: OrbState;
  size?: keyof typeof WRAP;
}) {
  const reduce = useReducedMotion();
  const agentState: AgentState =
    state === "idle"
      ? null
      : state === "speaking"
        ? "talking"
        : state === "thinking"
          ? "thinking"
          : "listening";

  return (
    <m.div
      initial={reduce ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className={cn("relative shrink-0", WRAP[size])}
    >
      <Suspense fallback={ORB_FALLBACK}>
        <Orb
          agentState={agentState}
          colors={ORB_COLORS}
          volumeMode="auto"
          className="h-full w-full"
        />
      </Suspense>
    </m.div>
  );
});
