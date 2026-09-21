import type { MessagingChannel, MessagingProviderKind, User } from "@prisma/client";
import { prisma } from "@/modules/shared/db";

/**
 * Resolves a provider-scoped external id to a MESH user, creating one on the
 * first valid message. Identities are never merged across providers on the
 * basis of a similar number or display name — a merge requires an explicit,
 * verified link, which is out of scope for the MVP.
 */
export async function resolveUser(params: {
  provider: MessagingProviderKind;
  channel: MessagingChannel;
  externalId: string;
}): Promise<User> {
  const existing = await prisma.messagingIdentity.findUnique({
    where: {
      provider_externalId: { provider: params.provider, externalId: params.externalId },
    },
    include: { user: true },
  });
  if (existing) return existing.user;

  return prisma.$transaction(async (tx) => {
    const raced = await tx.messagingIdentity.findUnique({
      where: {
        provider_externalId: { provider: params.provider, externalId: params.externalId },
      },
      include: { user: true },
    });
    if (raced) return raced.user;

    const user = await tx.user.create({ data: {} });
    await tx.messagingIdentity.create({
      data: {
        userId: user.id,
        provider: params.provider,
        channel: params.channel,
        externalId: params.externalId,
      },
    });
    await tx.relationshipProfile.create({ data: { userId: user.id } });
    await tx.consentRecord.create({
      data: { userId: user.id, scope: "SERVICE_USAGE", granted: true, source: "first_message" },
    });
    return user;
  });
}
