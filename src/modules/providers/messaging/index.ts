import { env } from "@/config/env";
import { MockMessagingAdapter } from "./mock";
import { PhotonMessagingAdapter } from "./photon";
import { WebFallbackAdapter } from "./webFallback";
import type { MessagingProvider } from "./types";

let instance: MessagingProvider | null = null;

export function messagingProvider(): MessagingProvider {
  if (instance) return instance;
  switch (env().MESSAGING_PROVIDER) {
    case "photon":
      instance = new PhotonMessagingAdapter();
      break;
    case "web_fallback":
      instance = new WebFallbackAdapter();
      break;
    default:
      instance = new MockMessagingAdapter();
  }
  return instance;
}

export function resetMessagingProvider(): void {
  instance = null;
}

export * from "./types";
