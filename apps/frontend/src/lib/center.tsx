import { createContext, use, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc, type Center } from "@/lib/orpc";

/**
 * The selected center — the tenant everything on screen belongs to. The
 * sidebar dropdown sets it; call log, staff, prompt, and new calls all scope
 * to it. The choice is stored server-side per admin (user_prefs), so it
 * follows them across browsers and devices; a local override makes switching
 * feel instant while the save is in flight.
 */

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
  const qc = useQueryClient();
  const { data: centers = [], isLoading } = useQuery(orpc.centers.list.queryOptions());
  const { data: selected } = useQuery(orpc.centers.selected.queryOptions());

  // Optimistic: reflect the click immediately, then persist server-side.
  const [override, setOverride] = useState<string | null>(null);

  const select = useMutation(
    orpc.centers.select.mutationOptions({
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: orpc.centers.selected.key() });
      },
    }),
  );

  const setCenterId = useCallback(
    (id: string) => {
      setOverride(id);
      select.mutate({ centerId: id });
    },
    // useMutation's mutate is a stable reference.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const value = useMemo<CenterCtx>(() => {
    const wantedId = override ?? selected?.id;
    const center = centers.find((c) => c.id === wantedId) ?? centers[0] ?? null;
    return { centers, center, centerId: center?.id ?? "", setCenterId, isLoading };
  }, [centers, selected, override, setCenterId, isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCenter(): CenterCtx {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useCenter must be used within CenterProvider");
  return ctx;
}
