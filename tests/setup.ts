import { beforeEach } from "vitest";
import { prisma } from "@/modules/shared/db";
import { resetMockMessaging } from "@/modules/providers/messaging/mock";

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PreferenceEvidence", "PreferenceCorrection", "PreferenceLearningEvent",
      "LearnedPreference", "RelationshipSignal", "RelationshipProfile",
      "Preference", "AIInference", "ConnectionIntent",
      "Interest", "Recommendation", "Availability", "VideoFeedback",
      "VideoAccessGrant", "VideoSession", "ContactExchangeConsent", "ContactMethod",
      "Connection", "Verification", "ConsentRecord", "UserBlock", "SafetyReport",
      "OutboxMessage", "AgentJob", "WebhookReceipt", "Message", "Conversation",
      "MessagingIdentity", "User"
    RESTART IDENTITY CASCADE;
  `);
  resetMockMessaging();
});
