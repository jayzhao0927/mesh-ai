import type { Conversation, MessagingChannel, MessagingProviderKind } from "@prisma/client";
import { prisma } from "@/modules/shared/db";

export async function getOrCreateConversation(params: {
  userId: string;
  provider: MessagingProviderKind;
  channel: MessagingChannel;
  externalConversationId: string;
}): Promise<Conversation> {
  const key = {
    provider: params.provider,
    externalConversationId: params.externalConversationId,
  };
  const existing = await prisma.conversation.findUnique({
    where: { provider_externalConversationId: key },
  });
  if (existing) return existing;

  return prisma.conversation.upsert({
    where: { provider_externalConversationId: key },
    update: {},
    create: {
      userId: params.userId,
      provider: params.provider,
      channel: params.channel,
      externalConversationId: params.externalConversationId,
    },
  });
}

/** Bounded recent context: the Agent never receives the full history. */
export async function recentTurns(conversationId: string, limit = 12) {
  const messages = await prisma.message.findMany({
    where: { conversationId, type: "TEXT" },
    orderBy: { receivedAt: "desc" },
    take: limit,
  });
  return messages
    .reverse()
    .map((m) => ({ role: m.direction === "INBOUND" ? ("user" as const) : ("agent" as const), text: m.text ?? "" }));
}
