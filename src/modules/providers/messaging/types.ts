import type { MessagingChannel, MessagingProviderKind } from "@prisma/client";

/** Normalized inbound message. Business code never sees provider payloads. */
export interface InboundMessage {
  provider: MessagingProviderKind;
  channel: MessagingChannel;
  externalMessageId: string;
  externalConversationId: string;
  senderExternalId: string;
  messageType: "TEXT" | "MEDIA" | "SYSTEM";
  text?: string;
  mediaUrl?: string;
  receivedAt: Date;
  /** Group / broadcast traffic must never enter the personal understanding path. */
  isGroup: boolean;
  isFromAgent: boolean;
}

export interface SendResult {
  /** UNKNOWN means the send outcome is undetermined: reconcile, never blind-retry. */
  status: "SENT" | "UNKNOWN";
  providerRef?: string;
}

export interface StartEntry {
  /** Deep link that opens the native Messages app with a prefilled body. */
  deepLink?: string;
  smsLink?: string;
  phoneNumber?: string;
  prefilledBody: string;
  available: boolean;
  unavailableReason?: string;
}

export interface VerifiedWebhook {
  messages: InboundMessage[];
  payloadHash: string;
}

export interface MessagingProvider {
  readonly kind: MessagingProviderKind;
  sendText(externalConversationId: string, text: string, dedupeKey: string): Promise<SendResult>;
  /** Entry point metadata for the website; deep-link rules live here, not in the UI. */
  startEntry(): StartEntry;
  verifyAndNormalize(rawBody: string, headers: Record<string, string>): Promise<VerifiedWebhook>;
}
