import { describe, expect, it } from "vitest";
import { prisma } from "@/modules/shared/db";
import { ingestInbound } from "@/modules/messaging/gateway";
import { runWorkerOnce } from "@/modules/messaging/worker";
import { mockSentMessages } from "@/modules/providers/messaging/mock";
import type { InboundMessage } from "@/modules/providers/messaging";

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    provider: "MOCK",
    channel: "WEB",
    externalMessageId: "m1",
    externalConversationId: "c1",
    senderExternalId: "+10000000001",
    messageType: "TEXT",
    text: "Hi MESH",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    isGroup: false,
    isFromAgent: false,
    ...overrides,
  };
}

describe("messaging gateway", () => {
  it("creates a user, conversation and exactly one job on first message", async () => {
    const outcome = await ingestInbound(inbound(), "hash");
    expect(outcome.status).toBe("ACCEPTED");
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.agentJob.count()).toBe(1);
  });

  it("suppresses duplicate webhook delivery without a second reply", async () => {
    await ingestInbound(inbound(), "hash");
    const replay = await ingestInbound(inbound(), "hash");
    expect(replay.status).toBe("DUPLICATE");
    expect(await prisma.agentJob.count()).toBe(1);

    await runWorkerOnce();
    await runWorkerOnce();
    expect(mockSentMessages("c1")).toHaveLength(1);
    expect(await prisma.message.count({ where: { direction: "OUTBOUND" } })).toBe(1);
  });

  it("rejects a reused external message id carrying different content", async () => {
    await ingestInbound(inbound(), "hash");
    await expect(ingestInbound(inbound({ text: "different" }), "hash")).rejects.toThrow(
      /different content/,
    );
  });

  it("keeps group messages and agent echoes out of the understanding path", async () => {
    expect((await ingestInbound(inbound({ isGroup: true }), "h")).status).toBe("IGNORED");
    expect(
      (await ingestInbound(inbound({ externalMessageId: "m2", isFromAgent: true }), "h"))
        .status,
    ).toBe("IGNORED");
    expect(await prisma.agentJob.count()).toBe(0);
  });

  it("does not merge two providers' identities that look alike", async () => {
    await ingestInbound(inbound(), "hash");
    await ingestInbound(
      inbound({
        provider: "WEB_FALLBACK",
        externalMessageId: "m2",
        externalConversationId: "c2",
      }),
      "hash",
    );
    expect(await prisma.user.count()).toBe(2);
  });

  it("retries a failed job without duplicating the reply", async () => {
    await ingestInbound(inbound(), "hash");
    await runWorkerOnce();
    // A redelivered job for the same inbound message reuses the reply dedupe key.
    await prisma.agentJob.updateMany({ data: { status: "PENDING", leaseExpiresAt: null } });
    await runWorkerOnce();
    expect(mockSentMessages("c1")).toHaveLength(1);
  });
});
