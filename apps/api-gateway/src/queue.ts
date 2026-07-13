import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { getCall, logCallEvent, markFailed, saveSummary } from "./calls";
import { emailEnabled, sendTransferEmail } from "./email";
import { env } from "./env";
import type { CallSummary, TranscriptTurn } from "./schema";
import { fallbackTransferBrief, summarizeForTransfer, summarizeTranscript } from "./summarize";

/**
 * BullMQ summarization pipeline. A locked call is enqueued as a "summarize"
 * job; the worker (in-process for the POC) reads its transcript, calls the
 * xAI text model, and writes the summary back. Retries with backoff cover a
 * transient model/network blip; an exhausted job marks the call failed.
 *
 * A second queue carries transfer briefs: enqueued the instant a transfer is
 * arranged (while the call is still live), its worker summarizes the
 * transcript-so-far and emails the receiving staff member so the brief lands
 * as the transferred call rings.
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

/* ── transfer briefs ──────────────────────────────────────────────────── */

const TRANSFER_QUEUE_NAME = "transfer-emails";

const transferQueue = new Queue(TRANSFER_QUEUE_NAME, { connection });

export interface TransferEmailJob {
  callId: string;
  target: { name: string; section: string; email: string };
  /** Snapshot of the conversation at the moment the transfer was arranged. */
  transcript: TranscriptTurn[];
  /** "Console call" or the caller's number — shown in the email footer. */
  sourceLabel: string;
  transferredAt: string;
  /** The center the call came into — names the email and sets its clock.
   *  Optional so jobs queued before the centers migration still deliver. */
  center?: { name: string; timezone: string };
}

/** Fire-and-forget from the live call path: never throws, only logs. */
export async function enqueueTransferEmail(job: TransferEmailJob): Promise<void> {
  try {
    if (!emailEnabled()) {
      await logCallEvent(job.callId, "transfer email skipped", "SMTP is not configured");
      return;
    }
    if (!job.target.email) {
      await logCallEvent(job.callId, "transfer email skipped", `${job.target.name} has no email`);
      return;
    }
    // One brief per call: a model retrying transfer_call (or a second
    // transfer on the same call) must not double-email the receiver. The
    // jobId makes BullMQ drop duplicates; the lookup is for the log.
    // (No ":" allowed — BullMQ reserves it as its Redis key separator.)
    const jobId = `transfer-${job.callId}`;
    if (await transferQueue.getJob(jobId)) {
      await logCallEvent(job.callId, "transfer email skipped", "already queued for this call");
      return;
    }
    await transferQueue.add("notify", job, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    await logCallEvent(
      job.callId,
      "transfer email queued",
      `${job.target.name} <${job.target.email}>`,
    );
  } catch (e) {
    console.error("[queue] transfer email enqueue failed:", e instanceof Error ? e.message : e);
  }
}

export function startTransferEmailWorker(): Worker {
  const worker = new Worker<TransferEmailJob>(
    TRANSFER_QUEUE_NAME,
    async (job) => {
      const { callId, target, transcript, sourceLabel, transferredAt, center } = job.data;
      let summary: CallSummary;
      try {
        summary = await summarizeForTransfer(transcript, target);
      } catch (e) {
        // A summary-model blip must not delay or drop the brief — fall back
        // to the caller's own words; only send failures retry the job.
        const detail = e instanceof Error ? e.message : String(e);
        await logCallEvent(
          callId,
          "transfer email degraded",
          `summary failed: ${detail.slice(0, 150)}`,
        );
        summary = fallbackTransferBrief(transcript, target);
      }
      await sendTransferEmail({
        to: target.email,
        staffName: target.name,
        summary,
        sourceLabel,
        transferredAt: new Date(transferredAt),
        callId,
        ...(center ? { center } : {}),
      });
      await logCallEvent(callId, "transfer email sent", `${target.name} <${target.email}>`);
    },
    { connection, concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] transfer email job ${job?.id} failed:`, err.message);
    // An email hiccup never fails the call record — just document it.
    if (job) {
      void logCallEvent(
        job.data.callId,
        `transfer email attempt ${job.attemptsMade} failed`,
        err.message.slice(0, 200),
      );
    }
  });

  return worker;
}
