import { MessagingProviderKind } from "@prisma/client";
import { env } from "@/config/env";
import { sha256 } from "@/modules/shared/crypto";
import { DomainError } from "@/modules/shared/errors";
import type { MessagingProvider, SendResult, StartEntry, VerifiedWebhook } from "./types";

/**
 * Web fallback for users who cannot open a native Messages app. It still owns
 * the deep-link rules so the UI never hardcodes them.
 */
export class WebFallbackAdapter implements MessagingProvider {
  readonly kind = MessagingProviderKind.WEB_FALLBACK;

  async sendText(): Promise<SendResult> {
    // Web fallback delivery is read back by the browser, not pushed.
    return { status: "SENT" };
  }

  startEntry(): StartEntry {
    const number = env().AGENT_PHONE_NUMBER;
    const body = "Hi MESH";
    if (!number) {
      return {
        prefilledBody: body,
        available: false,
        unavailableReason: "No Agent number is configured yet.",
      };
    }
    return {
      prefilledBody: body,
      phoneNumber: number,
      deepLink: `imessage://${number}&body=${encodeURIComponent(body)}`,
      smsLink: `sms:${number}?&body=${encodeURIComponent(body)}`,
      available: true,
    };
  }

  async verifyAndNormalize(rawBody: string): Promise<VerifiedWebhook> {
    throw Object.assign(
      new DomainError("Web fallback has no inbound webhook", "UNSUPPORTED", 400),
      { payloadHash: sha256(rawBody) },
    );
  }
}
