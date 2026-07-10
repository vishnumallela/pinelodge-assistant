import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BUILTIN_VOICES,
  modelSupportsReasoning,
  VOICE_MODELS,
  type ReasoningEffort,
} from "@/hooks/useVoiceAgent";
import { useVoiceSettings } from "@/lib/voice-settings";
import { cn } from "@/lib/utils";

/** Human-friendly model labels; the value stays the raw model id. */
const MODEL_LABELS: Record<string, string> = {
  "grok-voice-latest": "Latest",
  "grok-voice-think-fast-1.0": "Think · Fast",
  "grok-voice-fast-1.0": "Fast",
};

/**
 * Live control surface for the Grok realtime session — model, voice, reasoning
 * depth, VAD turn detection and playback speed. Changes persist immediately and
 * apply to the next call (the session config is snapshotted at connect time).
 */
export function VoiceSettingsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { settings, update, updateTurn, reset, isDefault } = useVoiceSettings();
  const reasoningOn = modelSupportsReasoning(settings.model);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-md">
        <SheetHeader>
          <SheetTitle>Voice session</SheetTitle>
          <SheetDescription>
            Tune the Grok realtime session. Changes save instantly and apply to the next call you
            start.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-7">
          <Field label="Model">
            <PillGroup
              value={settings.model}
              options={VOICE_MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] ?? m }))}
              onChange={(model) => update({ model })}
            />
          </Field>

          <Field label="Voice">
            <PillGroup
              value={settings.voice}
              options={BUILTIN_VOICES.map((v) => ({ value: v, label: cap(v) }))}
              onChange={(voice) => update({ voice })}
            />
            <Input
              value={settings.voice}
              onChange={(e) => update({ voice: e.target.value })}
              placeholder="voice id (built-in or custom)"
              spellCheck={false}
              className="mt-2 h-9 font-mono text-xs"
            />
          </Field>

          <Field
            label="Reasoning effort"
            hint={
              reasoningOn
                ? "High adds ~0.5s to first audio but improves replies."
                : "The Fast model has no reasoning stage — this is ignored."
            }
          >
            <PillGroup
              value={settings.reasoningEffort}
              disabled={!reasoningOn}
              options={[
                { value: "none" as ReasoningEffort, label: "None" },
                { value: "high" as ReasoningEffort, label: "High" },
              ]}
              onChange={(reasoningEffort) => update({ reasoningEffort })}
            />
          </Field>

          <div className="space-y-4 border-t border-border/60 pt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Turn detection (server VAD)
            </div>
            <Slider
              label="Threshold"
              value={settings.turnDetection.threshold}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(threshold) => updateTurn({ threshold })}
            />
            <Slider
              label="Silence duration"
              value={settings.turnDetection.silenceDurationMs}
              min={0}
              max={2000}
              step={50}
              format={(v) => `${v} ms`}
              onChange={(silenceDurationMs) => updateTurn({ silenceDurationMs })}
            />
            <Slider
              label="Prefix padding"
              value={settings.turnDetection.prefixPaddingMs}
              min={0}
              max={1000}
              step={50}
              format={(v) => `${v} ms`}
              onChange={(prefixPaddingMs) => updateTurn({ prefixPaddingMs })}
            />
            <Slider
              label="Idle timeout"
              value={settings.turnDetection.idleTimeoutMs}
              min={0}
              max={60000}
              step={1000}
              format={(v) => (v === 0 ? "off" : `${(v / 1000).toFixed(0)} s`)}
              onChange={(idleTimeoutMs) => updateTurn({ idleTimeoutMs })}
            />
          </div>

          <div className="space-y-4 border-t border-border/60 pt-6">
            <Slider
              label="Playback speed"
              value={settings.outputSpeed}
              min={0.5}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(outputSpeed) => update({ outputSpeed })}
            />
          </div>
        </SheetBody>

        <SheetFooter>
          <Button
            variant="ghost"
            className="mr-auto text-muted-foreground"
            disabled={isDefault}
            onClick={reset}
          >
            <RotateCcw className="mr-1.5 size-3.5" /> Reset to default
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function PillGroup<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", disabled && "pointer-events-none opacity-50")}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "tap h-8 select-none rounded-full px-3.5 text-xs font-medium transition-colors active:scale-[0.97]",
              active
                ? "bg-brand text-brand-foreground"
                : "bg-secondary text-secondary-foreground pf-hover:bg-secondary/80",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="normal-case tracking-normal text-foreground">{label}</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-brand"
      />
    </div>
  );
}
