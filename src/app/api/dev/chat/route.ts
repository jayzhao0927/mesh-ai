import { NextResponse } from "next/server";
import { z } from "zod";
import { devChatEnabled } from "@/config/env";
import { prisma } from "@/modules/shared/db";
import { ingestInbound } from "@/modules/messaging/gateway";
import { runWorkerOnce } from "@/modules/messaging/worker";
import { pendingSignals } from "@/modules/relationship/service";
import { DomainError } from "@/modules/shared/errors";

const bodySchema = z.object({
  externalId: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
  externalMessageId: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  if (!devChatEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { externalId, text, externalMessageId } = parsed.data;

  try {
    const outcome = await ingestInbound(
      {
        provider: "MOCK",
        channel: "WEB",
        externalMessageId,
        externalConversationId: externalId,
        senderExternalId: externalId,
        messageType: "TEXT",
        text,
        receivedAt: new Date(),
        isGroup: false,
        isFromAgent: false,
      },
      externalMessageId,
    );
    await runWorkerOnce();
    return NextResponse.json({ outcome, ...(await transcript(externalId)) });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    throw error;
  }
}

export async function GET(request: Request) {
  if (!devChatEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const externalId = new URL(request.url).searchParams.get("externalId");
  if (!externalId) {
    return NextResponse.json({ error: "externalId is required" }, { status: 400 });
  }
  return NextResponse.json(await transcript(externalId));
}

async function transcript(externalId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: {
      provider_externalConversationId: {
        provider: "MOCK",
        externalConversationId: externalId,
      },
    },
    include: { messages: { orderBy: { receivedAt: "asc" }, take: 100 } },
  });
  if (!conversation) return { messages: [], pending: [], userId: null, status: null };

  const [user, intent, connections] = await Promise.all([
    prisma.user.findUnique({ where: { id: conversation.userId } }),
    prisma.connectionIntent.findFirst({
      where: { userId: conversation.userId, endedAt: null },
      orderBy: { activeAt: "desc" },
    }),
    prisma.connection.findMany({
      where: {
        OR: [{ userAId: conversation.userId }, { userBId: conversation.userId }],
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const others = await prisma.user.findMany({
    where: {
      id: {
        in: connections.map((c) =>
          c.userAId === conversation.userId ? c.userBId : c.userAId,
        ),
      },
    },
    select: { id: true, displayName: true },
  });

  return {
    userId: conversation.userId,
    status: user
      ? {
          state: user.status,
          verified: Boolean(user.verifiedAt),
          poolEligible: Boolean(user.poolEligibleAt),
          city: user.city,
          ageYears: user.ageYears,
          intent: intent?.intent ?? null,
        }
      : null,
    connections: connections.map((c) => {
      const otherId = c.userAId === conversation.userId ? c.userBId : c.userAId;
      return {
        id: c.id,
        status: c.status,
        withName: others.find((o) => o.id === otherId)?.displayName ?? otherId,
      };
    }),
    messages: conversation.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      text: m.text,
      at: m.receivedAt,
    })),
    pending: (await pendingSignals(conversation.userId)).map((s) => ({
      id: s.id,
      category: s.category,
      key: s.key,
      value: s.value,
      confidence: s.confidence,
      source: s.source,
    })),
  };
}
