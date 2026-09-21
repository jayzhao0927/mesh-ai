import { MessagingProviderKind } from "@prisma/client";
import { NotImplementedByProvider } from "@/modules/shared/errors";
import type { MessagingProvider, SendResult, StartEntry, VerifiedWebhook } from "./types";

/**
 * Placeholder for the Photon iMessage/SMS adapter.
 *
 * The concrete Photon product, API version, signature scheme and webhook
 * envelope have NOT been verified against official documentation, so nothing
 * here is implemented: every call fails loudly instead of pretending the
 * channel is connected.
 */
export class PhotonMessagingAdapter implements MessagingProvider {
  readonly kind = MessagingProviderKind.PHOTON;

  async sendText(): Promise<SendResult> {
    throw new NotImplementedByProvider("PhotonMessagingAdapter", "sendText");
  }

  startEntry(): StartEntry {
    return {
      prefilledBody: "Hi MESH",
      available: false,
      unavailableReason:
        "Photon adapter is not connected: API contract and credentials are unverified.",
    };
  }

  async verifyAndNormalize(): Promise<VerifiedWebhook> {
    throw new NotImplementedByProvider("PhotonMessagingAdapter", "verifyAndNormalize");
  }
}
