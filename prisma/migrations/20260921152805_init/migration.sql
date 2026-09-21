-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ConnectionIntentType" AS ENUM ('DATING', 'MARRIAGE', 'FRIENDSHIP', 'MEANINGFUL_CONNECTION', 'UNSURE', 'OTHER');

-- CreateEnum
CREATE TYPE "MessagingProviderKind" AS ENUM ('PHOTON', 'MOCK', 'WEB_FALLBACK');

-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('IMESSAGE', 'SMS', 'WEB');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'MEDIA', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'LEASED', 'DONE', 'FAILED', 'NEEDS_RECONCILIATION');

-- CreateEnum
CREATE TYPE "SignalSource" AS ENUM ('USER_STATED', 'BEHAVIORAL', 'AI_INFERENCE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'UNSURE');

-- CreateEnum
CREATE TYPE "LearningEventType" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'LATER', 'NO_RESPONSE', 'VIDEO_ACCEPTED', 'VIDEO_DECLINED', 'VIDEO_COMPLETED', 'WANT_TO_CONTINUE', 'UNCOMFORTABLE', 'CONTACT_EXCHANGE', 'CONTACT_DECLINED', 'OFFLINE_MEETING', 'SECOND_MEETING', 'ONGOING_CONNECTION', 'USER_CORRECTION');

-- CreateEnum
CREATE TYPE "SignalDirection" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "LearningStage" AS ENUM ('RECOMMENDATION', 'INTEREST', 'VIDEO', 'POST_VIDEO', 'CONTACT_EXCHANGE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "LearnedPreferenceStatus" AS ENUM ('OBSERVING', 'CONFIRMED', 'REJECTED', 'UNSURE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CorrectionType" AS ENUM ('CONFIRM', 'REJECT', 'UNSURE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InterestState" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'LATER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('MUTUAL_INTEREST', 'VIDEO_SCHEDULED', 'VIDEO_COMPLETED', 'CONTACT_EXCHANGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VideoSessionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContinueAnswer" AS ENUM ('YES', 'MAYBE', 'NO');

-- CreateEnum
CREATE TYPE "ComfortAnswer" AS ENUM ('NATURAL', 'NEUTRAL', 'UNCOMFORTABLE');

-- CreateEnum
CREATE TYPE "ContactMethodKind" AS ENUM ('WECHAT', 'PHONE', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('SERVICE_USAGE', 'MATCHING_DATA', 'AI_IMPROVEMENT', 'THIRD_PARTY_PROCESSING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "ageYears" INTEGER,
    "city" TEXT,
    "timezone" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "connectionsPausedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "poolEligibleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "MessagingProviderKind" NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagingIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "MessagingProviderKind" NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "externalConversationId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "text" TEXT,
    "mediaUrl" TEXT,
    "provider" "MessagingProviderKind" NOT NULL,
    "externalMessageId" TEXT,
    "contentHash" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "provider" "MessagingProviderKind" NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" "SignalSource" NOT NULL,
    "sourceMessageId" TEXT,
    "evidenceQuote" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "matchable" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isHardFilter" BOOLEAN NOT NULL DEFAULT false,
    "statedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "Preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intent" "ConnectionIntentType" NOT NULL,
    "note" TEXT,
    "activeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ConnectionIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceLearningEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateUserId" TEXT,
    "recommendationId" TEXT,
    "connectionId" TEXT,
    "sourceEventId" TEXT NOT NULL,
    "eventType" "LearningEventType" NOT NULL,
    "signalDirection" "SignalDirection" NOT NULL,
    "stage" "LearningStage" NOT NULL,
    "explicitFeedback" TEXT,
    "derivedSignals" JSONB,
    "candidateAttributeSnapshot" JSONB,
    "exposureContext" JSONB,
    "evidenceGroupKey" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "policyVersion" TEXT NOT NULL DEFAULT 'v1',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "PreferenceLearningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnedPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "positiveEvidenceCount" INTEGER NOT NULL DEFAULT 0,
    "negativeEvidenceCount" INTEGER NOT NULL DEFAULT 0,
    "independentEvidenceCount" INTEGER NOT NULL DEFAULT 0,
    "source" "SignalSource" NOT NULL DEFAULT 'BEHAVIORAL',
    "status" "LearnedPreferenceStatus" NOT NULL DEFAULT 'OBSERVING',
    "policyVersion" TEXT NOT NULL DEFAULT 'v1',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnedPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceEvidence" (
    "id" TEXT NOT NULL,
    "learnedPreferenceId" TEXT NOT NULL,
    "learningEventId" TEXT NOT NULL,
    "supports" BOOLEAN NOT NULL,
    "rationale" TEXT NOT NULL,
    "contribution" DOUBLE PRECISION NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferenceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferenceCorrection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "learnedPreferenceId" TEXT NOT NULL,
    "correction" "CorrectionType" NOT NULL,
    "note" TEXT,
    "confidenceBefore" DOUBLE PRECISION NOT NULL,
    "confidenceAfter" DOUBLE PRECISION NOT NULL,
    "targetVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferenceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateUserId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT 'v1',
    "exposureContext" JSONB,
    "presentedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interest" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "state" "InterestState" NOT NULL DEFAULT 'UNKNOWN',
    "privateReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'MUTUAL_INTEREST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoSession" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 20,
    "status" "VideoSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAccessGrant" (
    "id" TEXT NOT NULL,
    "videoSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoFeedback" (
    "id" TEXT NOT NULL,
    "videoSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wantContinue" "ContinueAnswer" NOT NULL,
    "comfort" "ComfortAnswer" NOT NULL,
    "keepSearching" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ContactMethodKind" NOT NULL,
    "value" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactExchangeConsent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactMethodId" TEXT NOT NULL,
    "methodVersion" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "exchangedAt" TIMESTAMP(3),

    CONSTRAINT "ContactExchangeConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "detail" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessagingIdentity_userId_idx" ON "MessagingIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingIdentity_provider_externalId_key" ON "MessagingIdentity"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_provider_externalConversationId_key" ON "Conversation"("provider", "externalConversationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_receivedAt_idx" ON "Message"("conversationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_provider_externalMessageId_key" ON "Message"("provider", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentJob_dedupeKey_key" ON "AgentJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "AgentJob_status_createdAt_idx" ON "AgentJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_dedupeKey_key" ON "OutboxMessage"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_createdAt_idx" ON "OutboxMessage"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_provider_externalMessageId_key" ON "WebhookReceipt"("provider", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipProfile_userId_key" ON "RelationshipProfile"("userId");

-- CreateIndex
CREATE INDEX "RelationshipSignal_userId_category_key_idx" ON "RelationshipSignal"("userId", "category", "key");

-- CreateIndex
CREATE INDEX "Preference_userId_category_key_idx" ON "Preference"("userId", "category", "key");

-- CreateIndex
CREATE INDEX "AIInference_userId_idx" ON "AIInference"("userId");

-- CreateIndex
CREATE INDEX "ConnectionIntent_userId_idx" ON "ConnectionIntent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceLearningEvent_sourceEventId_key" ON "PreferenceLearningEvent"("sourceEventId");

-- CreateIndex
CREATE INDEX "PreferenceLearningEvent_userId_occurredAt_idx" ON "PreferenceLearningEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "PreferenceLearningEvent_evidenceGroupKey_idx" ON "PreferenceLearningEvent"("evidenceGroupKey");

-- CreateIndex
CREATE INDEX "LearnedPreference_userId_status_idx" ON "LearnedPreference"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LearnedPreference_userId_category_key_value_key" ON "LearnedPreference"("userId", "category", "key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceEvidence_learnedPreferenceId_dedupeKey_key" ON "PreferenceEvidence"("learnedPreferenceId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "PreferenceCorrection_idempotencyKey_key" ON "PreferenceCorrection"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PreferenceCorrection_userId_idx" ON "PreferenceCorrection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_tokenHash_key" ON "Verification"("tokenHash");

-- CreateIndex
CREATE INDEX "Verification_userId_idx" ON "Verification"("userId");

-- CreateIndex
CREATE INDEX "Recommendation_userId_createdAt_idx" ON "Recommendation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_userId_candidateUserId_key" ON "Recommendation"("userId", "candidateUserId");

-- CreateIndex
CREATE INDEX "Interest_targetUserId_idx" ON "Interest"("targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Interest_userId_targetUserId_key" ON "Interest"("userId", "targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_userAId_userBId_key" ON "Connection"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "Availability_connectionId_idx" ON "Availability"("connectionId");

-- CreateIndex
CREATE INDEX "VideoSession_connectionId_idx" ON "VideoSession"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoAccessGrant_tokenHash_key" ON "VideoAccessGrant"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "VideoAccessGrant_videoSessionId_userId_key" ON "VideoAccessGrant"("videoSessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoFeedback_videoSessionId_userId_key" ON "VideoFeedback"("videoSessionId", "userId");

-- CreateIndex
CREATE INDEX "ContactMethod_userId_idx" ON "ContactMethod"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactExchangeConsent_connectionId_userId_key" ON "ContactExchangeConsent"("connectionId", "userId");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_scope_idx" ON "ConsentRecord"("userId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "SafetyReport_reportedUserId_idx" ON "SafetyReport"("reportedUserId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "MessagingIdentity" ADD CONSTRAINT "MessagingIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipProfile" ADD CONSTRAINT "RelationshipProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipSignal" ADD CONSTRAINT "RelationshipSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Preference" ADD CONSTRAINT "Preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionIntent" ADD CONSTRAINT "ConnectionIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceLearningEvent" ADD CONSTRAINT "PreferenceLearningEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnedPreference" ADD CONSTRAINT "LearnedPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceEvidence" ADD CONSTRAINT "PreferenceEvidence_learnedPreferenceId_fkey" FOREIGN KEY ("learnedPreferenceId") REFERENCES "LearnedPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceEvidence" ADD CONSTRAINT "PreferenceEvidence_learningEventId_fkey" FOREIGN KEY ("learningEventId") REFERENCES "PreferenceLearningEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceCorrection" ADD CONSTRAINT "PreferenceCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferenceCorrection" ADD CONSTRAINT "PreferenceCorrection_learnedPreferenceId_fkey" FOREIGN KEY ("learnedPreferenceId") REFERENCES "LearnedPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_candidateUserId_fkey" FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interest" ADD CONSTRAINT "Interest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSession" ADD CONSTRAINT "VideoSession_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAccessGrant" ADD CONSTRAINT "VideoAccessGrant_videoSessionId_fkey" FOREIGN KEY ("videoSessionId") REFERENCES "VideoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAccessGrant" ADD CONSTRAINT "VideoAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoFeedback" ADD CONSTRAINT "VideoFeedback_videoSessionId_fkey" FOREIGN KEY ("videoSessionId") REFERENCES "VideoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoFeedback" ADD CONSTRAINT "VideoFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMethod" ADD CONSTRAINT "ContactMethod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactExchangeConsent" ADD CONSTRAINT "ContactExchangeConsent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactExchangeConsent" ADD CONSTRAINT "ContactExchangeConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactExchangeConsent" ADD CONSTRAINT "ContactExchangeConsent_contactMethodId_fkey" FOREIGN KEY ("contactMethodId") REFERENCES "ContactMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyReport" ADD CONSTRAINT "SafetyReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
