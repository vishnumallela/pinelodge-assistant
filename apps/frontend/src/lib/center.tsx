import { createContext, use, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { orpc, type Center } from "@/lib/orpc";

/**
 * The selected center — the tenant everything on screen belongs to. The
 * sidebar dropdown sets it; call log, staff, prompt, and new calls all scope
 * to it. Persisted in localStorage so the choice survives reloads; an id
 * that no longer exists falls back to the first center.
 */

const STORAGE_KEY = "pinelodge:center";

interface CenterCtx {
  centers: Center[];
  /** The selected center; null only while the list is first loading. */
  center: Center | null;
  /** Convenience: `center?.id ?? ""` — queries gate on it being non-empty. */
  centerId: string;
  setCenterId: (id: string) => void;
  isLoading: boolean;
}

const Ctx = createContext<CenterCtx | null>(null);

export function CenterProvider({ children }: { children: React.ReactNode }) {
  const { data: centers = [], isLoading } = useQuery(orpc.centers.list.queryOptions());

  const [storedId, setStoredId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const setCenterId = useCallback((id: string) => {
    setStoredId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode / quota — the choice still lives for this session */
    }
  }, []);

  const value = useMemo<CenterCtx>(() => {
    const center = centers.find((c) => c.id === storedId) ?? centers[0] ?? null;
    return { centers, center, centerId: center?.id ?? "", setCenterId, isLoading };
  }, [centers, storedId, setCenterId, isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCenter(): CenterCtx {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useCenter must be used within CenterProvider");
  return ctx;
}
