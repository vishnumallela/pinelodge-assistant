import { z } from "zod";
import { db } from "../db";
import { authed } from "../lib/orpc";
import { FACILITY } from "../lib/facility";
import {
  availabilitySnapshot,
  createStaff,
  deleteStaff,
  facilityNow,
  listStaff,
  updateStaff,
  DAY_KEYS,
} from "../lib/staff";
import { ROUTE_TARGETS } from "../lib/routing";
import {
  appendTranscript,
  completeCall,
  getCallDetail,
  listCalls,
  recordScreening,
  recordToolEvent,
  routeCall,
  saveCallerInfo,
  saveVoicemail,
  startCall,
  type CallRow,
} from "../lib/calls";
import { queueSummarization } from "../lib/summarize";

const dayKey = z.enum(DAY_KEYS);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM");

const staffInput = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().min(1),
  department: z.string().trim().min(1),
  extension: z.string().trim().min(1),
  workingDays: z.array(dayKey).min(1),
  shiftStart: hhmm,
  shiftEnd: hhmm,
  active: z.boolean(),
  fallbackDestination: z.string().trim().min(1),
});

const staffOut = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  department: z.string(),
  extension: z.string(),
  workingDays: z.array(z.string()),
  shiftStart: z.string(),
  shiftEnd: z.string(),
  active: z.boolean(),
  fallbackDestination: z.string(),
});

type StaffRowLike = Awaited<ReturnType<typeof listStaff>>[number];
function staffToOut(s: StaffRowLike): z.infer<typeof staffOut> {
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    department: s.department,
    extension: s.extension,
    workingDays: s.workingDays.split(","),
    shiftStart: s.shiftStart,
    shiftEnd: s.shiftEnd,
    active: s.active,
    fallbackDestination: s.fallbackDestination,
  };
}

const callSummaryOut = z.object({
  id: z.string(),
  status: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  callerName: z.string().nullable(),
  reason: z.string().nullable(),
  screening: z.string(),
  routeTarget: z.string().nullable(),
  destinationName: z.string().nullable(),
  transferOutcome: z.string(),
  summaryStatus: z.string(),
});

function callToSummary(c: CallRow): z.infer<typeof callSummaryOut> {
  return {
    id: c.id,
    status: c.status,
    startedAt: c.startedAt.toISOString(),
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSeconds: c.durationSeconds,
    callerName: c.callerName,
    reason: c.reason,
    screening: c.screening,
    routeTarget: c.routeTarget,
    destinationName: c.destinationName,
    transferOutcome: c.transferOutcome,
    summaryStatus: c.summaryStatus,
  };
}

const callId = z.object({ callId: z.string().trim().min(1) });

export const router = {
  facility: {
    info: authed.handler(() => FACILITY),
  },

  staff: {
    list: authed
      .output(z.array(staffOut))
      .handler(async () => (await listStaff(db)).map(staffToOut)),

    create: authed
      .input(staffInput)
      .output(staffOut)
      .handler(async ({ input }) => staffToOut(await createStaff(db, input))),

    update: authed
      .input(z.object({ id: z.string().trim().min(1), patch: staffInput.partial() }))
      .output(staffOut.nullable())
      .handler(async ({ input }) => {
        const row = await updateStaff(db, input.id, input.patch);
        return row ? staffToOut(row) : null;
      }),

    remove: authed
      .input(z.object({ id: z.string().trim().min(1) }))
      .output(z.object({ ok: z.boolean() }))
      .handler(async ({ input }) => ({ ok: await deleteStaff(db, input.id) })),
  },

  availability: authed.handler(() => availabilitySnapshot(db, facilityNow())),

  calls: {
    start: authed.handler(async () => {
      const row = await startCall(db);
      return { callId: row.id, startedAt: row.startedAt.toISOString() };
    }),

    // Stage 2 — the app decides what each screening outcome means.
    screen: authed
      .input(callId.extend({ classification: z.enum(["legitimate", "spam", "scam", "emergency"]) }))
      .handler(async ({ input }) => {
        const instruction = await recordScreening(db, input.callId, input.classification);
        await recordToolEvent(db, input.callId, "screen_call", instruction);
        return instruction;
      }),

    // Stage 3 — structured caller state, updated as information arrives.
    saveCallerInfo: authed
      .input(
        callId.extend({
          callerName: z.string().trim().optional(),
          callerPhone: z.string().trim().optional(),
          reason: z.string().trim().optional(),
          residentName: z.string().trim().optional(),
          relationship: z.string().trim().optional(),
          callbackTime: z.string().trim().optional(),
          urgency: z.string().trim().optional(),
          requestedStaff: z.string().trim().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const { callId: id, ...patch } = input;
        const result = await saveCallerInfo(db, id, patch);
        await recordToolEvent(db, id, "save_caller_info", { patch, missing: result.missing });
        return result;
      }),

    // Stage 6/7 — deterministic routing + simulated transfer.
    route: authed
      .input(callId.extend({ target: z.enum(ROUTE_TARGETS) }))
      .handler(async ({ input }) => {
        const instruction = await routeCall(db, input.callId, input.target, facilityNow());
        await recordToolEvent(db, input.callId, "route_call", {
          target: input.target,
          action: instruction.action,
          destination: instruction.destination?.name ?? null,
        });
        return instruction;
      }),

    voicemail: authed
      .input(callId.extend({ message: z.string().trim().min(1) }))
      .handler(async ({ input }) => {
        const ok = await saveVoicemail(db, input.callId, input.message);
        await recordToolEvent(db, input.callId, "leave_voicemail", { ok });
        return { ok };
      }),

    appendTranscript: authed
      .input(
        callId.extend({
          entries: z
            .array(
              z.object({
                entryId: z.string().min(1),
                seq: z.number().int().min(0),
                role: z.enum(["caller", "assistant"]),
                text: z.string().min(1),
              }),
            )
            .min(1),
        }),
      )
      .handler(({ input }) => appendTranscript(db, input.callId, input.entries)),

    // End of call: finalize metadata, then queue the async report job.
    complete: authed.input(callId).handler(async ({ input }) => {
      const row = await completeCall(db, input.callId);
      if (!row) return { ok: false };
      if (row.summaryStatus === "none") queueSummarization(db, row.id);
      return { ok: true, durationSeconds: row.durationSeconds };
    }),

    list: authed
      .output(z.array(callSummaryOut))
      .handler(async () => (await listCalls(db)).map(callToSummary)),

    get: authed.input(callId).handler(async ({ input }) => {
      const detail = await getCallDetail(db, input.callId);
      if (!detail) return null;
      const c = detail.call;
      return {
        ...callToSummary(c),
        callerPhone: c.callerPhone,
        residentName: c.residentName,
        relationship: c.relationship,
        callbackTime: c.callbackTime,
        urgency: c.urgency,
        requestedStaff: c.requestedStaff,
        destinationAvailable: c.destinationAvailable,
        voicemail: c.voicemail,
        transcript: detail.transcript.map((t) => ({
          entryId: t.entryId,
          seq: t.seq,
          role: t.role,
          text: t.text,
        })),
        toolEvents: detail.toolEvents.map((t) => ({
          name: t.name,
          detail: t.detail,
          at: t.at.toISOString(),
        })),
        report: detail.report
          ? {
              executiveSummary: detail.report.executiveSummary,
              callerIntent: detail.report.callerIntent,
              informationCollected: detail.report.informationCollected,
              routingDecision: detail.report.routingDecision,
              followUp: detail.report.followUp,
              finalDisposition: detail.report.finalDisposition,
              model: detail.report.model,
              createdAt: detail.report.createdAt.toISOString(),
            }
          : null,
      };
    }),
  },
};

export type AppRouter = typeof router;
