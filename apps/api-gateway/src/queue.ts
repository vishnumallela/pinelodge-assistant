import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { getCall, logCallEvent, markFailed, saveSummary } from "./calls";
import { env } from "./env";
import { summarizeTranscript } from "./summarize";

/**
 * BullMQ summarization pipeline. A locked call is enqueued as a "summarize"
 * job; the worker (in-process for the POC) reads its transcript, calls the
 * xAI text model, and writes the summary back. Retries with backoff cover a
 * transient model/network blip; an exhausted job marks the call failed.
 */

const QUEUE_NAME = "call-summaries";

// BullMQ needs maxRetriesPerRequest: null on the shared connection.
const connection: ConnectionOptions = { url: env.REDIS_URL, maxRetriesPerRequest: null };

const summaryQueue = new Queue(QUEUE_NAME, { connection });

interface SummarizeJob {
  callId: string;
}

export async function enqueueSummary(job: SummarizeJob): Promise<void> {
  await summaryQueue.add("summarize", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });
  await logCallEvent(job.callId, "summary queued");
}

export function startSummaryWorker(): Worker {
  const worker = new Worker<SummarizeJob>(
    QUEUE_NAME,
    async (job) => {
      const call = await getCall(job.data.callId);
      if (!call) return;
      const summary = await summarizeTranscript(call.transcript);
      await saveSummary(call.id, summary);
      await logCallEvent(call.id, "summary written", summary.headline);
    },
    { connection, concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] summary job ${job?.id} failed:`, err.message);
    if (job) {
      void logCallEvent(
        job.data.callId,
        `summary attempt ${job.attemptsMade} failed`,
        err.message.slice(0, 200),
      );
      // Only give up (mark the call failed) once retries are exhausted.
      if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
        void markFailed(job.data.callId);
      }
    }
  });

  return worker;
}
