import { z } from "zod";
import { ConnectionIntentType } from "@prisma/client";
import { prisma } from "@/modules/shared/db";
import { AuthorizationError, DomainError } from "@/modules/shared/errors";
import { confirmedFacts, pendingSignals } from "@/modules/relationship/service";

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
      await prisma.relationshipSignal.update({
        where: { id: args.signalId },
        data: { reviewStatus: "CONFIRMED", userConfirmed: true, matchable: true },
      });
      return { ok: true, message: "Signal confirmed" };
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
