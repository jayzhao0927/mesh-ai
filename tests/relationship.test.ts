import { describe, expect, it } from "vitest";
import { prisma } from "@/modules/shared/db";
import { ingestInbound } from "@/modules/messaging/gateway";
import { runWorkerOnce } from "@/modules/messaging/worker";
import { confirmedFacts, pendingSignals, rejectSignal } from "@/modules/relationship/service";
import { runTool } from "@/modules/agent/tools";
import type { InboundMessage } from "@/modules/providers/messaging";

async function say(text: string, id: string): Promise<string> {
  const message: InboundMessage = {
    provider: "MOCK",
    channel: "WEB",
    externalMessageId: id,
    externalConversationId: "c1",
    senderExternalId: "+10000000001",
    messageType: "TEXT",
    text,
    receivedAt: new Date(),
    isGroup: false,
    isFromAgent: false,
  };
  const outcome = await ingestInbound(message, id);
  await runWorkerOnce();
  if (outcome.status !== "ACCEPTED") throw new Error(`unexpected ${outcome.status}`);
  return outcome.userId;
}

describe("relationship intelligence", () => {
  it("stores what the Agent heard as unconfirmed and unmatchable", async () => {
    const userId = await say("我搬到上海了", "m1");
    const pending = await pendingSignals(userId);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((s) => !s.matchable && !s.userConfirmed)).toBe(true);
    expect(await confirmedFacts(userId)).toEqual([]);
  });

  it("only exposes a fact after the user confirms it", async () => {
    const userId = await say("我搬到上海了", "m1");
    const [signal] = await pendingSignals(userId);
    const result = await runTool({ userId }, "confirm_relationship_signal", {
      signalId: signal.id,
    });
    expect(result.ok).toBe(true);
    expect(await confirmedFacts(userId)).toContainEqual({ key: "city", value: "上海" });
  });

  it("does not let a rejected signal quietly come back", async () => {
    const userId = await say("我搬到上海了", "m1");
    const [signal] = await pendingSignals(userId);
    await rejectSignal(userId, signal.id);
    await say("我搬到上海了", "m2");
    const revived = await prisma.relationshipSignal.findMany({
      where: { userId, key: "city", supersededAt: null },
    });
    expect(revived).toHaveLength(0);
  });

  it("refuses to act on another user's signal", async () => {
    const userId = await say("我搬到上海了", "m1");
    const [signal] = await pendingSignals(userId);
    const other = await prisma.user.create({ data: {} });
    await expect(
      runTool({ userId: other.id }, "confirm_relationship_signal", { signalId: signal.id }),
    ).rejects.toThrow(/Not authorized/);
  });

  it("pauses connections when the user asks", async () => {
    const userId = await say("暂停帮我找人", "m1");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe("PAUSED");
    expect(user.connectionsPausedAt).not.toBeNull();
  });

  it("rejects unknown tools instead of reporting success", async () => {
    const userId = await say("Hi MESH", "m1");
    const result = await runTool({ userId }, "delete_everything", {});
    expect(result.ok).toBe(false);
  });
});
