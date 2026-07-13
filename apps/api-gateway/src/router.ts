import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { createCall, endCall, getCall, listCallsPage, logCallEvent, saveTranscript } from "./calls";
import {
  createCenter,
  deleteCenter,
  getCenter,
  getDefaultCenter,
  isValidTimezone,
  listCenters,
  numberClaimedElsewhere,
  setCenterNumber,
  updateCenter,
} from "./centers";
import { env } from "./env";
import { defaultGreeting, defaultTemplate, getAgentPrompt, saveTemplate } from "./prompt";
import { enqueueSummary, enqueueTransferEmail } from "./queue";
import type { CenterRow } from "./schema";
import {
  createStaff,
  deleteStaff,
  findRedirectTarget,
  listAttachablePeople,
  listStaff,
  updateStaff,
} from "./staff";
import { twilioEnabled } from "./twilio";
import {
  configureNumber,
  listOwnedNumbers,
  purchaseNumber,
  releaseNumber,
  searchAvailableNumbers,
  twilioErrorMessage,
  twilioNumbersEnabled,
} from "./twilio-numbers";

/**
 * Typed API surface for the dashboard, mounted at /orpc. The context carries
 * whether the session belongs to an allowlisted admin (resolved in server.ts)
 * and the deployment's public origin (for webhook URLs). Center-scoped
 * procedures take an explicit centerId — the dashboard's center dropdown.
 */

export interface RpcContext {
  admin: boolean;
  origin: string;
}

const base = os.$context<RpcContext>();

const authed = base.use(({ context, next }) => {
  if (!context.admin) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  return next();
});

const transcriptSchema = z.array(
  z.object({ role: z.enum(["caller", "assistant"]), text: z.string() }),
);

const centerIdSchema = z.string().uuid();

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/)
  .or(z.literal(""));

const staffInputSchema = z.object({
  name: z.string().trim().min(1),
  section: z.string().trim().min(1),
  handles: z.string().trim().default(""),
  phone: phoneSchema.default(""),
  email: z.string().trim().toLowerCase().email().or(z.literal("")).default(""),
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeOff: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  isFallback: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.number().int().optional(),
});

const centerFieldsSchema = z.object({
  name: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
});

async function requireCenter(centerId: string): Promise<CenterRow> {
  const center = await getCenter(centerId);
  if (!center) throw new ORPCError("NOT_FOUND", { message: "Center not found." });
  return center;
}

function requireTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new ORPCError("BAD_REQUEST", { message: `Unknown timezone "${timezone}".` });
  }
}

/** Which roster a call's transfers resolve against. Legacy rows without a
 *  center fall back to the default one. */
async function centerForCall(callCenterId: string | null): Promise<CenterRow> {
  const center =
    (callCenterId ? await getCenter(callCenterId) : null) ?? (await getDefaultCenter());
  if (!center) throw new ORPCError("NOT_FOUND", { message: "No center is configured." });
  return center;
}

function promptDefaults(center: CenterRow): { template: string; greeting: string } {
  return { template: defaultTemplate(center.name), greeting: defaultGreeting(center.name) };
}

async function agentPromptOrThrow(centerId: string) {
  const agent = await getAgentPrompt(centerId);
  if (!agent) throw new ORPCError("NOT_FOUND", { message: "Center not found." });
  return { ...agent, defaults: promptDefaults(agent.center) };
}

function webhookUrl(origin: string): string {
  return `${origin}/api/twilio/incoming`;
}

/** Twilio REST failures become readable BAD_REQUESTs instead of 500s. */
async function twilioCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new ORPCError("BAD_REQUEST", { message: twilioErrorMessage(e) });
  }
}

export const router = {
  centers: {
    list: authed.handler(() => listCenters()),

    create: authed.input(centerFieldsSchema).handler(({ input }) => {
      requireTimezone(input.timezone);
      return createCenter(input);
    }),

    update: authed
      .input(
        z.object({
          id: centerIdSchema,
          data: centerFieldsSchema.extend({
            active: z.boolean().default(true),
            /** Manual number entry, for numbers wired up outside the app.
             *  Omit to leave the line untouched; "" clears it. */
            phoneNumber: phoneSchema.optional(),
          }),
        }),
      )
      .handler(async ({ input }) => {
        requireTimezone(input.data.timezone);
        const { phoneNumber, ...fields } = input.data;
        const row = await updateCenter(input.id, fields);
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Center not found." });
        if (phoneNumber === undefined) return row;
        if (await numberClaimedElsewhere(phoneNumber, input.id)) {
          throw new ORPCError("CONFLICT", {
            message: "Another center already uses that number.",
          });
        }
        // A hand-entered number may not match the stored Twilio SID anymore.
        const updated = await setCenterNumber(input.id, phoneNumber, "");
        return updated ?? row;
      }),

    remove: authed.input(z.object({ id: centerIdSchema })).handler(async ({ input }) => {
      const res = await deleteCenter(input.id);
      if (!res.ok) throw new ORPCError("CONFLICT", { message: res.error ?? "Cannot delete." });
      return { ok: true };
    }),
  },

  calls: {
    list: authed
      .input(
        z.object({
          centerId: centerIdSchema,
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(5).max(100).default(20),
        }),
      )
      .handler(({ input }) => listCallsPage(input.centerId, input.page, input.pageSize)),

    get: authed.input(z.object({ id: z.string().uuid() })).handler(async ({ input }) => {
      const call = await getCall(input.id);
      if (!call) throw new ORPCError("NOT_FOUND", { message: "Call not found." });
      return call;
    }),

    create: authed.input(z.object({ centerId: centerIdSchema })).handler(async ({ input }) => {
      const center = await requireCenter(input.centerId);
      const call = await createCall("console", center.id);
      await logCallEvent(call.id, "call created", `console (${center.name})`);
      return call;
    }),

    saveTranscript: authed
      .input(z.object({ id: z.string().uuid(), transcript: transcriptSchema }))
      .handler(async ({ input }) => {
        const ok = await saveTranscript(input.id, input.transcript);
        if (!ok) throw new ORPCError("CONFLICT", { message: "Call is locked or not found." });
        return { ok: true };
      }),

    end: authed
      .input(z.object({ id: z.string().uuid(), transcript: transcriptSchema }))
      .handler(async ({ input }) => {
        const row = await endCall(input.id, input.transcript);
        if (!row) throw new ORPCError("CONFLICT", { message: "Call is locked or not found." });
        await logCallEvent(input.id, "call ended", `console, ${row.durationSeconds ?? 0}s`);
        await enqueueSummary({ callId: row.id });
        return row;
      }),

    /** Sarah's console transfer_call: the redirect is announce-only (no dial
     *  leg), but the named staff member is briefed by email immediately. */
    transfer: authed
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().trim().min(1),
          transcript: transcriptSchema,
        }),
      )
      .handler(async ({ input }) => {
        const call = await getCall(input.id);
        if (!call) throw new ORPCError("NOT_FOUND", { message: "Call not found." });
        // Persist the turns spoken so far; a locked call can't transfer.
        const saved = await saveTranscript(input.id, input.transcript);
        if (!saved) throw new ORPCError("CONFLICT", { message: "Call is locked or not found." });
        const center = await centerForCall(call.centerId);
        const target = await findRedirectTarget(input.name, center);
        if (!target) {
          await logCallEvent(
            input.id,
            "transfer failed",
            `asked for "${input.name}", nobody available`,
          );
          return {
            ok: false as const,
            error: "Nobody is available to take this transfer right now.",
          };
        }
        await logCallEvent(input.id, "transfer announced", `${target.name} (${target.section})`);
        await enqueueTransferEmail({
          callId: input.id,
          target: { name: target.name, section: target.section, email: target.email },
          transcript: input.transcript,
          sourceLabel: "Console call",
          transferredAt: new Date().toISOString(),
          center: { name: center.name, timezone: center.timezone },
        });
        return { ok: true as const, connecting: `${target.name} in ${target.section}` };
      }),
  },

  staff: {
    list: authed
      .input(z.object({ centerId: centerIdSchema }))
      .handler(async ({ input }) => listStaff(await requireCenter(input.centerId))),

    /** People from other centers who can be attached to this one. */
    people: authed.input(z.object({ centerId: centerIdSchema })).handler(async ({ input }) => {
      await requireCenter(input.centerId);
      return listAttachablePeople(input.centerId);
    }),

    create: authed
      .input(
        z.object({
          centerId: centerIdSchema,
          /** Attach this existing person instead of creating a new one. */
          staffId: z.string().uuid().optional(),
          data: staffInputSchema,
        }),
      )
      .handler(async ({ input }) => {
        await requireCenter(input.centerId);
        const row = await createStaff(input.centerId, input.data, input.staffId);
        if (!row) {
          throw new ORPCError("CONFLICT", {
            message: "That person is already on this center's roster.",
          });
        }
        return row;
      }),

    update: authed
      .input(z.object({ id: z.string().uuid(), data: staffInputSchema }))
      .handler(async ({ input }) => {
        const row = await updateStaff(input.id, input.data);
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Staff member not found." });
        return row;
      }),

    remove: authed.input(z.object({ id: z.string().uuid() })).handler(async ({ input }) => {
      const ok = await deleteStaff(input.id);
      if (!ok) throw new ORPCError("NOT_FOUND", { message: "Staff member not found." });
      return { ok: true };
    }),
  },

  prompt: {
    get: authed
      .input(z.object({ centerId: centerIdSchema }))
      .handler(({ input }) => agentPromptOrThrow(input.centerId)),
    save: authed
      .input(
        z.object({
          centerId: centerIdSchema,
          template: z.string().trim().min(1),
          greeting: z.string().trim().min(1),
        }),
      )
      .handler(async ({ input }) => {
        await requireCenter(input.centerId);
        await saveTemplate(input.centerId, input.template, input.greeting);
        return agentPromptOrThrow(input.centerId);
      }),
  },

  phone: {
    config: authed.handler(({ context }) => ({
      twilio: {
        enabled: twilioEnabled(),
        hasApiKey: Boolean(env.XAI_API_KEY),
        /** Number management needs TWILIO_ACCOUNT_SID on top of the token. */
        numbersEnabled: twilioNumbersEnabled(),
        voiceWebhookUrl: webhookUrl(context.origin),
        streamUrl: `${context.origin.replace(/^http/, "ws")}/api/twilio/stream`,
      },
    })),

    numbers: {
      /** Every number the Twilio account owns, tagged with the center that
       *  claims it (matched by SID, then by the number itself). */
      list: authed.handler(async () => {
        const [numbers, allCenters] = await Promise.all([
          twilioCall(() => listOwnedNumbers()),
          listCenters(),
        ]);
        return numbers.map((n) => {
          const owner =
            allCenters.find((c) => c.twilioNumberSid && c.twilioNumberSid === n.sid) ??
            allCenters.find((c) => c.phoneNumber && c.phoneNumber === n.phoneNumber);
          return { ...n, center: owner ? { id: owner.id, name: owner.name } : null };
        });
      }),

      search: authed
        .input(
          z.object({
            country: z.string().trim().length(2).toUpperCase().default("US"),
            areaCode: z
              .string()
              .trim()
              .regex(/^\d{3}$/)
              .optional(),
            contains: z
              .string()
              .trim()
              .regex(/^[\dA-Za-z*]{1,10}$/)
              .optional(),
          }),
        )
        .handler(({ input }) => twilioCall(() => searchAvailableNumbers(input))),

      /** Buy the number, point its webhook here, and give it to the center. */
      buy: authed
        .input(z.object({ centerId: centerIdSchema, phoneNumber: phoneSchema.refine(Boolean) }))
        .handler(async ({ input, context }) => {
          const center = await requireCenter(input.centerId);
          const bought = await twilioCall(() =>
            purchaseNumber({
              phoneNumber: input.phoneNumber,
              voiceUrl: webhookUrl(context.origin),
              friendlyName: center.name,
            }),
          );
          return setCenterNumber(center.id, bought.phoneNumber, bought.sid);
        }),

      /** Point an already-owned number at this deployment and this center. */
      attach: authed
        .input(z.object({ centerId: centerIdSchema, sid: z.string().trim().min(1) }))
        .handler(async ({ input, context }) => {
          const center = await requireCenter(input.centerId);
          const owned = await twilioCall(() => listOwnedNumbers());
          const number = owned.find((n) => n.sid === input.sid);
          if (!number) throw new ORPCError("NOT_FOUND", { message: "Number not found." });
          if (await numberClaimedElsewhere(number.phoneNumber, center.id)) {
            throw new ORPCError("CONFLICT", {
              message: "Another center already uses that number.",
            });
          }
          const configured = await twilioCall(() =>
            configureNumber(input.sid, {
              voiceUrl: webhookUrl(context.origin),
              friendlyName: center.name,
            }),
          );
          return setCenterNumber(center.id, configured.phoneNumber, configured.sid);
        }),

      /** Forget the center's number without touching Twilio. */
      detach: authed.input(z.object({ centerId: centerIdSchema })).handler(async ({ input }) => {
        await requireCenter(input.centerId);
        return setCenterNumber(input.centerId, "", "");
      }),

      /** Release the number back to Twilio — it stops billing and ringing. */
      release: authed.input(z.object({ centerId: centerIdSchema })).handler(async ({ input }) => {
        const center = await requireCenter(input.centerId);
        if (!center.twilioNumberSid) {
          throw new ORPCError("BAD_REQUEST", {
            message: "This center's number is not managed from the app.",
          });
        }
        await twilioCall(() => releaseNumber(center.twilioNumberSid));
        return setCenterNumber(center.id, "", "");
      }),

      /** Re-point the number's voice webhook at this deployment. */
      syncWebhook: authed
        .input(z.object({ centerId: centerIdSchema }))
        .handler(async ({ input, context }) => {
          const center = await requireCenter(input.centerId);
          if (!center.twilioNumberSid) {
            throw new ORPCError("BAD_REQUEST", {
              message: "This center's number is not managed from the app.",
            });
          }
          await twilioCall(() =>
            configureNumber(center.twilioNumberSid, { voiceUrl: webhookUrl(context.origin) }),
          );
          return { ok: true, voiceWebhookUrl: webhookUrl(context.origin) };
        }),
    },
  },
};

export type AppRouter = typeof router;
