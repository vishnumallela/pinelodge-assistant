import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import {
  describeConfig,
  getConfig,
  GROK_REALTIME_MODELS,
  GROK_VOICES,
  saveConfig,
  XAI_SUMMARY_MODELS,
} from "./app-config";
import {
  createCall,
  endCall,
  getCall,
  listCallsPage,
  listMessagesPage,
  logCallEvent,
  saveTranscript,
  setTriage,
} from "./calls";
import {
  createCenter,
  deleteCenter,
  getCenter,
  getDefaultCenter,
  getSelectedCenter,
  isAfterHours,
  isValidTimezone,
  listCenters,
  numberClaimedElsewhere,
  setCenterNumber,
  setSelectedCenter,
  updateCenter,
} from "./centers";
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
  /** Better Auth user id of the signed-in admin ("" when unauthenticated). */
  userId: string;
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

const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const centerFieldsSchema = z.object({
  name: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
  /** After-hours protocol: past the cutoff, callers hear the staff-has-left
   *  greeting and the call becomes message-only. */
  afterHoursEnabled: z.boolean().optional(),
  afterHoursStart: hhmmSchema.optional(),
  afterHoursEnd: hhmmSchema.optional(),
  afterHoursGreeting: z.string().trim().max(500).optional(),
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

    /** The signed-in admin's active center — stored server-side so the
     *  dropdown choice follows them across browsers and devices. */
    selected: authed.handler(async ({ context }) => {
      const center = await getSelectedCenter(context.userId);
      if (!center) throw new ORPCError("NOT_FOUND", { message: "No center is configured." });
      return center;
    }),

    select: authed
      .input(z.object({ centerId: centerIdSchema }))
      .handler(async ({ input, context }) => {
        await requireCenter(input.centerId);
        await setSelectedCenter(context.userId, input.centerId);
        return { ok: true };
      }),

    /** One-step creation: optionally give the center its line right away —
     *  a hand-typed number, an owned Twilio number to attach, or a catalog
     *  number to buy. Attach/buy point the voice webhook here automatically,
     *  so the new center answers calls with zero Twilio console work. */
    create: authed
      .input(
        centerFieldsSchema.extend({
          phoneNumber: phoneSchema.optional(),
          attachSid: z.string().trim().min(1).optional(),
          buyNumber: phoneSchema.optional(),
        }),
      )
      .handler(async ({ input, context }) => {
        requireTimezone(input.timezone);
        const { phoneNumber, attachSid, buyNumber, ...fields } = input;

        // Resolve the line first, so a Twilio failure never leaves a
        // half-configured center behind.
        let line: { phoneNumber: string; sid: string } | null = null;
        if (buyNumber) {
          const bought = await twilioCall(() =>
            purchaseNumber({
              phoneNumber: buyNumber,
              voiceUrl: webhookUrl(context.origin),
              friendlyName: fields.name,
            }),
          );
          line = { phoneNumber: bought.phoneNumber, sid: bought.sid };
        } else if (attachSid) {
          const owned = await twilioCall(() => listOwnedNumbers());
          const number = owned.find((n) => n.sid === attachSid);
          if (!number) throw new ORPCError("NOT_FOUND", { message: "Number not found." });
          if (await numberClaimedElsewhere(number.phoneNumber)) {
            throw new ORPCError("CONFLICT", {
              message: "Another center already uses that number.",
            });
          }
          const configured = await twilioCall(() =>
            configureNumber(attachSid, {
              voiceUrl: webhookUrl(context.origin),
              friendlyName: fields.name,
            }),
          );
          line = { phoneNumber: configured.phoneNumber, sid: configured.sid };
        } else if (phoneNumber) {
          if (await numberClaimedElsewhere(phoneNumber)) {
            throw new ORPCError("CONFLICT", {
              message: "Another center already uses that number.",
            });
          }
          line = { phoneNumber, sid: "" };
        }

        const center = await createCenter(fields);
        if (!line) return center;
        return (await setCenterNumber(center.id, line.phoneNumber, line.sid)) ?? center;
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
      const afterHours = isAfterHours(center);
      const call = await createCall("console", center.id, afterHours ? "message" : "standard");
      await logCallEvent(
        call.id,
        "call created",
        `console (${center.name}${afterHours ? ", after hours" : ""})`,
      );
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

  /** The after-hours inbox — every message-only call across all centers,
   *  so a platform-level person (Dessa) triages both facilities in one
   *  place each morning. */
  messages: {
    list: authed
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(5).max(100).default(20),
          onlyOpen: z.boolean().default(false),
        }),
      )
      .handler(({ input }) => listMessagesPage(input.page, input.pageSize, input.onlyOpen)),

    setTriage: authed
      .input(z.object({ id: z.string().uuid(), triage: z.enum(["open", "done"]) }))
      .handler(async ({ input }) => {
        const ok = await setTriage(input.id, input.triage);
        if (!ok) throw new ORPCError("NOT_FOUND", { message: "Message not found." });
        return { ok: true };
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

  settings: {
    /** Every configurable value with its effective state; secrets masked to
     *  a set/unset flag. */
    get: authed.handler(() => describeConfig()),
    /** Save dashboard edits — applies to the next call, no restart. An empty
     *  string (or null) reverts the key to its env/default fallback. */
    save: authed
      .input(
        z.object({
          xaiApiKey: z.string().trim().nullable().optional(),
          // Dropdown fields only accept their known-good options — a stray
          // string can never reach the xAI API.
          grokRealtimeModel: z.enum(GROK_REALTIME_MODELS).nullable().optional(),
          grokRealtimeVoice: z.enum(GROK_VOICES).nullable().optional(),
          xaiSummaryModel: z.enum(XAI_SUMMARY_MODELS).nullable().optional(),
          twilioAccountSid: z.string().trim().nullable().optional(),
          twilioAuthToken: z.string().trim().nullable().optional(),
          smtpHost: z.string().trim().nullable().optional(),
          smtpPort: z.number().int().positive().nullable().optional(),
          smtpSecure: z.boolean().nullable().optional(),
          smtpUser: z.string().trim().nullable().optional(),
          smtpPass: z.string().nullable().optional(),
          smtpAuthMethod: z.enum(["login", "plain"]).nullable().optional(),
          emailFrom: z.string().trim().nullable().optional(),
          appUrl: z
            .string()
            .trim()
            .url()
            .transform((s) => s.replace(/\/$/, ""))
            .or(z.literal(""))
            .nullable()
            .optional(),
        }),
      )
      .handler(async ({ input }) => {
        await saveConfig(input);
        return describeConfig();
      }),
  },

  phone: {
    config: authed.handler(async ({ context }) => {
      const [enabled, numbersEnabled, config] = await Promise.all([
        twilioEnabled(),
        twilioNumbersEnabled(),
        getConfig(),
      ]);
      return {
        twilio: {
          enabled,
          hasApiKey: Boolean(config.xaiApiKey),
          /** Number management needs the Account SID on top of the token. */
          numbersEnabled,
          voiceWebhookUrl: webhookUrl(context.origin),
          streamUrl: `${context.origin.replace(/^http/, "ws")}/api/twilio/stream`,
        },
      };
    }),

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
