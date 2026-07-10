import { createContext, use, useCallback, useMemo, useState } from "react";

import {
  DEFAULT_TURN_DETECTION,
  DEFAULT_VOICE_SESSION_CONFIG,
  type VoiceSessionConfig,
} from "@/hooks/useVoiceAgent";

/**
 * Browser-persisted Grok session knobs (voice, model, reasoning, VAD, speed).
 * Kept in localStorage so tweaks survive reloads and apply to the next call —
 * a testing surface for dialing the receptionist in without redeploys.
 */

const STORAGE_KEY = "pinelodge:voice-settings";

function load(): Required<VoiceSessionConfig> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SESSION_CONFIG };
    const parsed = JSON.parse(raw) as Partial<VoiceSessionConfig>;
    return {
      ...DEFAULT_VOICE_SESSION_CONFIG,
      ...parsed,
      turnDetection: { ...DEFAULT_TURN_DETECTION, ...parsed.turnDetection },
    };
  } catch {
    return { ...DEFAULT_VOICE_SESSION_CONFIG };
  }
}

interface VoiceSettingsCtx {
  settings: Required<VoiceSessionConfig>;
  /** Shallow-merge a patch (turnDetection is replaced wholesale — see set). */
  update: (patch: Partial<VoiceSessionConfig>) => void;
  /** Patch a single turn-detection field, merging with the rest. */
  updateTurn: (patch: Partial<VoiceSessionConfig["turnDetection"]>) => void;
  reset: () => void;
  isDefault: boolean;
}

const Ctx = createContext<VoiceSettingsCtx | null>(null);

export function VoiceSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Required<VoiceSessionConfig>>(load);

  const write = useCallback((next: Required<VoiceSessionConfig>) => {
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — settings still live for this session */
    }
  }, []);

  const value = useMemo<VoiceSettingsCtx>(
    () => ({
      settings,
      update: (patch) => write({ ...settings, ...patch }),
      updateTurn: (patch) =>
        write({ ...settings, turnDetection: { ...settings.turnDetection, ...patch } }),
      reset: () => write({ ...DEFAULT_VOICE_SESSION_CONFIG }),
      isDefault: JSON.stringify(settings) === JSON.stringify(DEFAULT_VOICE_SESSION_CONFIG),
    }),
    [settings, write],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVoiceSettings(): VoiceSettingsCtx {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useVoiceSettings must be used within VoiceSettingsProvider");
  return ctx;
}
