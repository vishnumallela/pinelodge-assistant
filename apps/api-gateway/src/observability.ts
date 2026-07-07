import { env } from "./env";

/**
 * Voice observability sink: ships structured records to OpenObserve (or any
 * compatible JSON-ingest endpoint) so call traces are searchable outside
 * Railway's log tail. Env-gated by OBSERVE_URL + OBSERVE_USER/PASSWORD; when
 * unset everything is a no-op and the in-app event timeline still works.
 *
 * Records batch in memory and flush every 2s (or at 50 records) to
 * POST {OBSERVE_URL}/api/{OBSERVE_ORG}/{stream}/_json with basic auth.
 */

interface ObserveRecord {
  _timestamp: string;
  service: string;
  [key: string]: unknown;
}

const queues = new Map<string, ObserveRecord[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function observeEnabled(): boolean {
  return Boolean(env.OBSERVE_URL && env.OBSERVE_USER && env.OBSERVE_PASSWORD);
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (!observeEnabled()) {
    queues.clear();
    return;
  }
  const auth = `Basic ${Buffer.from(`${env.OBSERVE_USER}:${env.OBSERVE_PASSWORD}`).toString("base64")}`;
  const batches = new Map(queues);
  queues.clear();
  for (const [stream, records] of batches) {
    if (records.length === 0) continue;
    try {
      await fetch(`${env.OBSERVE_URL}/api/${env.OBSERVE_ORG}/${stream}/_json`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify(records),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      // Observability must never break call handling; drop and note it once.
      console.error(`[observe] ship to ${stream} failed:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Queue one record onto a stream; fire-and-forget. */
export function ship(stream: string, record: Record<string, unknown>): void {
  if (!observeEnabled()) return;
  const q = queues.get(stream) ?? [];
  q.push({ _timestamp: new Date().toISOString(), service: "api-gateway", ...record });
  queues.set(stream, q);
  if (q.length >= 50) {
    void flush();
    return;
  }
  flushTimer ??= setTimeout(() => void flush(), 2000);
}
