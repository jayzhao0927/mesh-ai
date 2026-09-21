import { z } from "zod";
import { ComfortAnswer, ConnectionIntentType, ContactMethodKind, ContinueAnswer } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { env } from "@/config/env";
import { AuthorizationError, DomainError } from "@/modules/shared/errors";
import { confirmSignal, confirmedFacts, pendingSignals } from "@/modules/relationship/service";
import {
  introductionText,
  nextRecommendation,
  openRecommendation,
  respondToRecommendation,
} from "@/modules/matching/service";
import { correctHypothesis, listHypotheses } from "@/modules/learning/service";
import {
  activeConnection,
  currentVideoSession,
  defaultSlots,
  formatSlot,
  overlappingSlots,
  scheduleVideo,
  shareAvailability,
  userTimezone,
} from "@/modules/video/service";
import { submitVideoFeedback } from "@/modules/video/feedback";
import {
  contactMethodsOf,
  declineContactExchange,
  grantContactExchange,
  setContactMethod,
} from "@/modules/contact/service";

export interface ToolContext {
  /** Bound by the server from the resolved messaging identity, never by the model. */
  userId: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  message: string;
}

interface ToolDefinition<S extends z.ZodTypeAny> {
  name: string;
  schema: S;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolResult>;
}

/** Registered form: arguments are validated inside, so the registry can stay
 *  free of per-tool generics. */
interface RegisteredTool {
  name: string;
  execute: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

function tool<S extends z.ZodTypeAny>(definition: ToolDefinition<S>): RegisteredTool {
  return {
    name: definition.name,
    execute: async (ctx, args) => {
      const parsed = definition.schema.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          message: `Invalid arguments for ${definition.name}: ${parsed.error.message}`,
        };
      }
      return definition.run(ctx, parsed.data);
    },
  };
}

const tools: RegisteredTool[] = [
  tool({
    name: "get_relationship_profile",
    schema: z.object({}),
    run: async (ctx) => {
      const [facts, pending, profile] = await Promise.all([
        confirmedFacts(ctx.userId),
        pendingSignals(ctx.userId),
        prisma.relationshipProfile.findUnique({ where: { userId: ctx.userId } }),
      ]);
      return {
        ok: true,
        data: {
          summary: profile?.summary ?? null,
          confirmed: facts,
          awaitingConfirmation: pending.map((p) => ({ key: p.key, value: p.value })),
        },
        message: "Profile read",
      };
    },
  }),
  tool({
    name: "set_connection_intent",
    schema: z.object({
      intent: z.nativeEnum(ConnectionIntentType),
      note: z.string().max(280).optional(),
    }),
    run: async (ctx, args) => {
      await prisma.$transaction(async (tx) => {
        await tx.connectionIntent.updateMany({
          where: { userId: ctx.userId, endedAt: null },
          data: { endedAt: new Date() },
        });
        await tx.connectionIntent.create({
          data: { userId: ctx.userId, intent: args.intent, note: args.note },
        });
      });
      return { ok: true, message: `Connection intent set to ${args.intent}` };
    },
  }),
  tool({
    name: "pause_connections",
    schema: z.object({}),
    run: async (ctx) => {
      await prisma.user.update({
        where: { id: ctx.userId },
        data: { status: "PAUSED", connectionsPausedAt: new Date() },
      });
      return { ok: true, message: "Connections paused" };
    },
  }),
  tool({
    name: "resume_connections",
    schema: z.object({}),
    run: async (ctx) => {
      await prisma.user.update({
        where: { id: ctx.userId },
        data: { status: "ACTIVE", connectionsPausedAt: null },
      });
      return { ok: true, message: "Connections resumed" };
    },
  }),
  tool({
    name: "confirm_relationship_signal",
    schema: z.object({ signalId: z.string().min(1) }),
    run: async (ctx, args) => {
      const signal = await prisma.relationshipSignal.findUnique({
        where: { id: args.signalId },
      });
      if (!signal) throw new DomainError("Signal not found", "NOT_FOUND", 404);
      if (signal.userId !== ctx.userId) throw new AuthorizationError();
      await confirmSignal(ctx.userId, args.signalId);
      return { ok: true, message: "Signal confirmed" };
    },
  }),
  tool({
    name: "find_next_connection",
    schema: z.object({}),
    run: async (ctx) => {
      const outcome = await nextRecommendation(ctx.userId);
      if (outcome.status === "NOT_ELIGIBLE") {
        const agentText =
          outcome.reason === "PAUSED"
            ? "You asked me to pause introductions, so I'm holding off. Tell me when you'd like me to start looking again."
            : "Before I introduce anyone, you'll need to finish verification — it's what keeps the other side real too.";
        return { ok: true, data: { agentText }, message: `Not eligible: ${outcome.reason}` };
      }
      if (outcome.status === "NO_CANDIDATE") {
        return {
          ok: true,
          data: {
            agentText:
              "Nobody worth introducing you to right now. I'd rather wait than send you someone I don't believe in — I'll come back when that changes.",
          },
          message: "No candidate",
        };
      }
      const recommendation = outcome.recommendation;
      const agentText = await introductionText(recommendation);
      if (!recommendation.presentedAt) {
        await prisma.recommendation.update({
          where: { id: recommendation.id },
          data: { presentedAt: new Date() },
        });
      }
      return {
        ok: true,
        data: { agentText, recommendationId: recommendation.id },
        message: outcome.status === "CREATED" ? "Recommendation created" : "Recommendation repeated",
      };
    },
  }),
  tool({
    name: "respond_to_recommendation",
    schema: z.object({
      state: z.enum(["INTERESTED", "NOT_INTERESTED", "LATER"]),
      recommendationId: z.string().min(1).optional(),
      privateReason: z.string().max(500).optional(),
    }),
    run: async (ctx, args) => {
      const target = args.recommendationId
        ? await prisma.recommendation.findUnique({ where: { id: args.recommendationId } })
        : await openRecommendation(ctx.userId);
      if (!target) {
        return {
          ok: false,
          data: { agentText: "There's no introduction waiting on your answer right now." },
          message: "No open recommendation",
        };
      }
      if (target.userId !== ctx.userId) throw new AuthorizationError();

      const result = await respondToRecommendation({
        userId: ctx.userId,
        recommendationId: target.id,
        state: args.state,
        privateReason: args.privateReason,
      });

      let agentText: string;
      if (result.state === "LATER") {
        agentText = "No rush — I'll keep it open and won't read anything into it.";
      } else if (result.state === "NOT_INTERESTED") {
        agentText = "Understood, I'll pass. If you want to tell me what didn't fit, it helps me — but you don't have to.";
      } else if (result.mutual) {
        agentText =
          "Good news: you're both interested. Next step is a single 20-minute video call — I'll sort out a time that works for you both.";
      } else {
        agentText = "Noted. I'll check with them and let you know — no chasing, no notifications in between.";
      }
      return { ok: true, data: { agentText, mutual: result.mutual }, message: `Interest: ${result.state}` };
    },
  }),
  tool({
    name: "get_learned_preferences",
    schema: z.object({}),
    run: async (ctx) => {
      const hypotheses = await listHypotheses(ctx.userId);
      const usable = hypotheses.filter((h) => h.status !== "REJECTED" && h.confidence > 0);
      if (usable.length === 0) {
        return {
          ok: true,
          data: {
            agentText:
              "Nothing I'd call a pattern yet. I'd rather wait for a few real connections than guess from one.",
          },
          message: "No hypotheses",
        };
      }
      const lines = usable
        .slice(0, 3)
        .map(
          (h) =>
            `\u2022 ${h.key === "topic" ? "people who are into" : h.key.replace(/_/g, " ")} ${h.value}` +
            ` (${h.status === "CONFIRMED" ? "you confirmed this" : "still just something I've noticed"})`,
        );
      return {
        ok: true,
        data: {
          agentText: [
            "Here's what I think I'm seeing so far. These are guesses, not conclusions \u2014 tell me if any of them is off:",
            ...lines,
          ].join("\n"),
          hypotheses: usable.map((h) => ({ id: h.id, key: h.key, value: h.value, status: h.status })),
        },
        message: `${usable.length} hypotheses`,
      };
    },
  }),
  tool({
    name: "correct_preference_hypothesis",
    schema: z.object({
      correction: z.enum(["CONFIRM", "REJECT", "UNSURE"]),
      hypothesisId: z.string().min(1).optional(),
      note: z.string().max(500).optional(),
    }),
    run: async (ctx, args) => {
      const target = args.hypothesisId
        ? await prisma.learnedPreference.findUnique({ where: { id: args.hypothesisId } })
        : (await listHypotheses(ctx.userId)).find(
            (h) => h.status === "OBSERVING" && h.confidence > 0,
          );
      if (!target) {
        return {
          ok: false,
          data: { agentText: "I don't have a guess on the table right now \u2014 nothing to take back." },
          message: "No hypothesis to correct",
        };
      }
      if (target.userId !== ctx.userId) throw new AuthorizationError();

      const { hypothesis } = await correctHypothesis({
        userId: ctx.userId,
        learnedPreferenceId: target.id,
        correction: args.correction,
        note: args.note,
        idempotencyKey: `${ctx.userId}:${target.id}:${args.correction}`,
      });
      const agentText =
        args.correction === "CONFIRM"
          ? `Good \u2014 I'll treat that as something you actually want, not a guess.`
          : args.correction === "REJECT"
            ? `Understood. I'll drop that one and won't use it when I pick who to introduce.`
            : `Fair \u2014 I'll hold it loosely and keep watching instead of acting on it.`;
      return {
        ok: true,
        data: { agentText, hypothesisId: hypothesis.id, status: hypothesis.status },
        message: `Hypothesis ${hypothesis.status}`,
      };
    },
  }),
  tool({
    name: "propose_video_times",
    schema: z.object({}),
    run: async (ctx) => {
      const connection = await activeConnection(ctx.userId);
      if (!connection) {
        return {
          ok: false,
          data: { agentText: "There's no connection waiting on a call right now." },
          message: "No active connection",
        };
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      const timezone = userTimezone(user.timezone);
      const slots = defaultSlots(timezone);
      await shareAvailability({ userId: ctx.userId, connectionId: connection.id, slots });

      const shared = await overlappingSlots(connection.id);
      if (shared.length === 0) {
        return {
          ok: true,
          data: {
            agentText:
              "I've passed your times along. As soon as I have theirs, I'll come back with a slot that works for you both.",
          },
          message: "Availability stored, no overlap yet",
        };
      }
      const lines = shared
        .slice(0, 3)
        .map((slot, index) => `${index + 1}. ${formatSlot(slot, timezone)} (${timezone})`);
      return {
        ok: true,
        data: {
          agentText: [
            "You both have these free for a 20-minute video call:",
            ...lines,
            "Tell me which one and I'll book it.",
          ].join("\n"),
          connectionId: connection.id,
        },
        message: `${shared.length} overlapping slots`,
      };
    },
  }),
  tool({
    name: "schedule_video",
    schema: z.object({ slotIndex: z.number().int().min(0).max(9) }),
    run: async (ctx, args) => {
      const connection = await activeConnection(ctx.userId);
      if (!connection) {
        return {
          ok: false,
          data: { agentText: "There's no connection waiting on a call right now." },
          message: "No active connection",
        };
      }
      const scheduled = await scheduleVideo({
        userId: ctx.userId,
        connectionId: connection.id,
        slotIndex: args.slotIndex,
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      const timezone = userTimezone(user.timezone);
      const link = `${env().APP_BASE_URL}/video/${scheduled.token}`;
      return {
        ok: true,
        data: {
          agentText: [
            `Booked: ${formatSlot(scheduled.slot, timezone)} (${timezone}), 20 minutes.`,
            `Your link \u2014 it's yours alone and expires after the call: ${link}`,
            "(Mock video room \u2014 there's no real call behind it in this build.)",
          ].join("\n\n"),
          videoSessionId: scheduled.session.id,
        },
        message: "Video scheduled",
      };
    },
  }),
  tool({
    name: "submit_video_feedback",
    schema: z.object({
      wantContinue: z.nativeEnum(ContinueAnswer),
      comfort: z.nativeEnum(ComfortAnswer),
      keepSearching: z.boolean().default(true),
      note: z.string().max(500).optional(),
    }),
    run: async (ctx, args) => {
      const connection = await activeConnection(ctx.userId);
      const session = connection ? await currentVideoSession(connection.id) : null;
      if (!connection || !session || session.status !== "COMPLETED") {
        return {
          ok: false,
          data: { agentText: "Once the call is done I'll ask you how it went." },
          message: "No completed video session",
        };
      }
      const outcome = await submitVideoFeedback({
        userId: ctx.userId,
        videoSessionId: session.id,
        wantContinue: args.wantContinue,
        comfort: args.comfort,
        keepSearching: args.keepSearching,
        note: args.note,
      });

      let agentText: string;
      if (args.wantContinue !== "YES") {
        agentText =
          "Thanks for telling me \u2014 that stays between us. I won't pass any of it on.";
      } else if (outcome.mutualContinue) {
        agentText =
          "You both want to keep going. If you'd like, tell me which contact detail to share \u2014 WeChat, phone, or something else \u2014 and I'll only pass it on once you've both agreed.";
      } else {
        agentText = "Noted, and kept private. I'll let you know when I've heard from them.";
      }
      if (!args.keepSearching) {
        agentText += "\n\nI've also paused new introductions until you tell me otherwise.";
      }
      return {
        ok: true,
        data: { agentText, mutualContinue: outcome.mutualContinue },
        message: `Feedback: ${args.wantContinue}`,
      };
    },
  }),
  tool({
    name: "set_contact_method",
    schema: z.object({
      kind: z.nativeEnum(ContactMethodKind),
      value: z.string().min(2).max(120),
    }),
    run: async (ctx, args) => {
      const method = await setContactMethod({
        userId: ctx.userId,
        kind: args.kind,
        value: args.value,
      });
      return {
        ok: true,
        data: {
          agentText: `Got it. I'm holding your ${args.kind.toLowerCase()} and I won't share it until you tell me to, for one specific person.`,
          contactMethodId: method.id,
        },
        message: `Contact method ${args.kind} v${method.version} stored`,
      };
    },
  }),
  tool({
    name: "consent_contact_exchange",
    schema: z.object({ kind: z.nativeEnum(ContactMethodKind).optional() }),
    run: async (ctx, args) => {
      const connection = await activeConnection(ctx.userId);
      if (!connection) {
        return {
          ok: false,
          data: { agentText: "There's no connection at that stage right now." },
          message: "No active connection",
        };
      }
      const methods = await contactMethodsOf(ctx.userId);
      const method = args.kind ? methods.find((m) => m.kind === args.kind) : methods[0];
      if (!method) {
        return {
          ok: false,
          data: {
            agentText: "Tell me what to share first \u2014 a WeChat id or a phone number \u2014 and I'll ask them the same.",
          },
          message: "No contact method on file",
        };
      }
      const outcome = await grantContactExchange({
        userId: ctx.userId,
        connectionId: connection.id,
        contactMethodId: method.id,
      });
      if (outcome.status === "WAITING_FOR_THEM" || !outcome.counterpart) {
        return {
          ok: true,
          data: {
            agentText:
              "Saved. Nothing goes across until they've agreed too \u2014 I'll tell you the moment that happens.",
          },
          message: "Consent stored, waiting for the other side",
        };
      }
      return {
        ok: true,
        data: {
          agentText: [
            `You're both in. ${outcome.counterpart.displayName}'s ${outcome.counterpart.kind.toLowerCase()}: ${outcome.counterpart.value}`,
            "You can talk directly now. I'll step out \u2014 I won't be in the middle of this one any more. If you ever want to tell me how it went, I'm here.",
          ].join("\n\n"),
        },
        message: "Contact exchanged",
      };
    },
  }),
  tool({
    name: "decline_contact_exchange",
    schema: z.object({}),
    run: async (ctx) => {
      const connection = await activeConnection(ctx.userId);
      if (!connection) {
        return {
          ok: false,
          data: { agentText: "There's nothing waiting on that decision." },
          message: "No active connection",
        };
      }
      await declineContactExchange({ userId: ctx.userId, connectionId: connection.id });
      return {
        ok: true,
        data: {
          agentText:
            "That's fine, and they won't be told why. Nothing of yours has been shared.",
        },
        message: "Contact exchange declined",
      };
    },
  }),
];

const registry = new Map(tools.map((t) => [t.name, t]));

export function toolNames(): string[] {
  return [...registry.keys()];
}

/**
 * Validates arguments, binds the user server-side and returns the real
 * execution result. An unknown tool fails rather than reporting success.
 */
export async function runTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const entry = registry.get(name);
  if (!entry) return { ok: false, message: `Unknown tool: ${name}` };
  return entry.execute(ctx, args);
}
