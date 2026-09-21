import { MessagingProviderKind } from "@prisma/client";
import { sha256 } from "@/modules/shared/crypto";
import { DomainError } from "@/modules/shared/errors";
import type {
  InboundMessage,
  MessagingProvider,
  SendResult,
  StartEntry,
  VerifiedWebhook,
} from "./types";

export const MOCK_START_BODY = "Hi MESH";

interface MockSent {
  externalConversationId: string;
  text: string;
  dedupeKey: string;
  at: Date;
}

/** In-memory transcript of everything the Agent "sent", used by /dev/chat. */
const sentLog: MockSent[] = [];

export function mockSentMessages(externalConversationId?: string): MockSent[] {
  return externalConversationId
    ? sentLog.filter((m) => m.externalConversationId === externalConversationId)
    : [...sentLog];
}

export function resetMockMessaging(): void {
  sentLog.length = 0;
}

export class MockMessagingAdapter implements MessagingProvider {
  readonly kind = MessagingProviderKind.MOCK;

  async sendText(
    externalConversationId: string,
    text: string,
    dedupeKey: string,
  ): Promise<SendResult> {
    if (sentLog.some((m) => m.dedupeKey === dedupeKey)) {
      return { status: "SENT", providerRef: dedupeKey };
    }
    sentLog.push({ externalConversationId, text, dedupeKey, at: new Date() });
    return { status: "SENT", providerRef: dedupeKey };
  }

  startEntry(): StartEntry {
    return {
      prefilledBody: MOCK_START_BODY,
      available: false,
      unavailableReason:
        "Mock messaging adapter: no real Agent number is connected in this environment.",
    };
  }

  async verifyAndNormalize(rawBody: string): Promise<VerifiedWebhook> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new DomainError("Invalid JSON body", "INVALID_BODY", 400);
    }
    const body = parsed as Partial<InboundMessage> & { text?: string };
    if (!body.externalMessageId || !body.senderExternalId) {
      throw new DomainError(
        "externalMessageId and senderExternalId are required",
        "INVALID_BODY",
        400,
      );
    }
    const message: InboundMessage = {
      provider: MessagingProviderKind.MOCK,
      channel: "WEB",
      externalMessageId: body.externalMessageId,
      externalConversationId: body.externalConversationId ?? body.senderExternalId,
      senderExternalId: body.senderExternalId,
      messageType: body.messageType ?? "TEXT",
      text: body.text,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
      isGroup: body.isGroup ?? false,
      isFromAgent: body.isFromAgent ?? false,
    };
    return { messages: [message], payloadHash: sha256(rawBody) };
  }
}
