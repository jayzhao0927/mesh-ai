import { describe, expect, it } from "vitest";
import { prisma } from "@/modules/shared/db";
import { nextRecommendation, respondToRecommendation } from "@/modules/matching/service";
import { completeVerification, startVerification } from "@/modules/verification/service";
import {
  completeVideo,
  defaultSlots,
  overlappingSlots,
  redeemVideoToken,
  scheduleVideo,
  shareAvailability,
} from "@/modules/video/service";
import { myFeedback, submitVideoFeedback } from "@/modules/video/feedback";
import { MockAIProvider } from "@/modules/providers/ai/mock";
import {
  declineContactExchange,
  grantContactExchange,
  setContactMethod,
} from "@/modules/contact/service";

async function person(name: string, timezone = "Asia/Shanghai") {
  const user = await prisma.user.create({
    data: { displayName: name, ageYears: 30, city: "上海", languages: ["zh"], timezone },
  });
  const { token } = await startVerification(user.id);
  await completeVerification(token);
  await prisma.connectionIntent.create({ data: { userId: user.id, intent: "DATING" } });
  return user;
}

/** Two real people who both said yes, which is the only way a connection exists. */
async function connectedPair() {
  const a = await person("A");
  const b = await person("B");
  for (const user of [a, b]) {
    const rec = await nextRecommendation(user.id);
    if (rec.status !== "CREATED") throw new Error("expected a recommendation");
    await respondToRecommendation({
      userId: user.id,
      recommendationId: rec.recommendation.id,
      state: "INTERESTED",
    });
  }
  const connection = await prisma.connection.findFirstOrThrow();
  return { a, b, connection };
}

async function scheduled() {
  const { a, b, connection } = await connectedPair();
  const slots = defaultSlots("Asia/Shanghai");
  await shareAvailability({ userId: a.id, connectionId: connection.id, slots });
  await shareAvailability({ userId: b.id, connectionId: connection.id, slots: slots.slice(1) });
  const booked = await scheduleVideo({ userId: a.id, connectionId: connection.id, slotIndex: 0 });
  const theirGrant = await prisma.videoAccessGrant.findFirstOrThrow({
    where: { videoSessionId: booked.session.id, userId: b.id },
  });
  return { a, b, connection, booked, theirGrantId: theirGrant.id };
}

describe("availability and scheduling", () => {
  it("offers only windows both sides kept free", async () => {
    const { a, b, connection } = await connectedPair();
    const slots = defaultSlots("Asia/Shanghai");
    await shareAvailability({ userId: a.id, connectionId: connection.id, slots });
    await shareAvailability({
      userId: b.id,
      connectionId: connection.id,
      slots: [slots[2]],
    });

    const shared = await overlappingSlots(connection.id);
    expect(shared).toHaveLength(1);
    expect(shared[0].startAt.toISOString()).toBe(slots[2].startAt.toISOString());
  });

  it("anchors the windows to the user's own timezone", async () => {
    const shanghai = defaultSlots("Asia/Shanghai")[0].startAt;
    const london = defaultSlots("Europe/London")[0].startAt;
    expect(shanghai.toISOString()).not.toBe(london.toISOString());
    const localHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        hour12: false,
      }).format(london),
    );
    expect(localHour).toBe(20);
  });

  it("refuses a time the two of them do not share", async () => {
    const { a, b, connection } = await connectedPair();
    const slots = defaultSlots("Asia/Shanghai");
    await shareAvailability({ userId: a.id, connectionId: connection.id, slots: [slots[0]] });
    await shareAvailability({ userId: b.id, connectionId: connection.id, slots: [slots[1]] });

    await expect(
      scheduleVideo({ userId: a.id, connectionId: connection.id, slotIndex: 0 }),
    ).rejects.toThrow(/you both have free/);
  });

  it("refuses to schedule for a connection the user is not part of", async () => {
    const { connection } = await connectedPair();
    const stranger = await person("Stranger");
    await expect(
      scheduleVideo({ userId: stranger.id, connectionId: connection.id, slotIndex: 0 }),
    ).rejects.toThrow(/Not authorized/);
  });

  it("books one 20-minute call and gives each side its own link", async () => {
    const { booked, a, b } = await scheduled();
    expect(booked.session.durationMins).toBe(20);
    const grants = await prisma.videoAccessGrant.findMany({
      where: { videoSessionId: booked.session.id },
    });
    expect(grants.map((g) => g.userId).sort()).toEqual([a.id, b.id].sort());
    // Only the hash is stored; the raw token never lands in the database.
    expect(grants.some((g) => g.tokenHash === booked.token)).toBe(false);
  });
});

describe("video access grants", () => {
  it("opens the room for the person the link was issued to", async () => {
    const { booked, a, b } = await scheduled();
    const room = await redeemVideoToken(booked.token);
    expect(room.userId).toBe(a.id);
    expect(room.counterpartName).toBe(b.displayName);
    expect(room.isMock).toBe(true);
  });

  it("rejects a link it never issued", async () => {
    await scheduled();
    await expect(redeemVideoToken("not-a-real-token")).rejects.toThrow(/isn't valid/);
  });

  it("rejects a link past its expiry", async () => {
    const { booked, a } = await scheduled();
    await prisma.videoAccessGrant.updateMany({
      where: { videoSessionId: booked.session.id, userId: a.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(redeemVideoToken(booked.token)).rejects.toThrow(/expired/);
  });

  it("kills both links once the call is over", async () => {
    const { booked } = await scheduled();
    await redeemVideoToken(booked.token);
    await completeVideo(booked.session.id);
    await expect(redeemVideoToken(booked.token)).rejects.toThrow(/revoked/);
    const live = await prisma.videoAccessGrant.count({
      where: { videoSessionId: booked.session.id, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it("does not put a database id in the link", async () => {
    const { booked } = await scheduled();
    expect(booked.token).not.toContain(booked.session.id);
    expect(booked.token.length).toBeGreaterThanOrEqual(32);
  });
});

describe("post-video feedback", () => {
  it("records finishing the call as neutral, not as liking the person", async () => {
    const { booked, a } = await scheduled();
    await completeVideo(booked.session.id);
    const event = await prisma.preferenceLearningEvent.findFirstOrThrow({
      where: { userId: a.id, eventType: "VIDEO_COMPLETED" },
    });
    expect(event.signalDirection).toBe("NEUTRAL");
    expect(event.weight).toBe(0);
  });

  it("asks each side for feedback once the call is over", async () => {
    const { booked, a, b } = await scheduled();
    const conversations = await Promise.all(
      [a, b].map((user, i) =>
        prisma.conversation.create({
          data: {
            userId: user.id,
            provider: "MOCK",
            channel: "SMS",
            externalConversationId: `conv-${booked.session.id}-${i}`,
          },
        }),
      ),
    );
    await completeVideo(booked.session.id);
    await completeVideo(booked.session.id);

    const queued = await prisma.outboxMessage.findMany({
      where: { conversationId: { in: conversations.map((c) => c.id) } },
    });
    expect(queued).toHaveLength(2);
    expect(queued[0].text).toMatch(/none of it goes to them/);
  });

  it("keeps each answer private to the person who gave it", async () => {
    const { booked, a, b } = await scheduled();
    await completeVideo(booked.session.id);
    await submitVideoFeedback({
      userId: a.id,
      videoSessionId: booked.session.id,
      wantContinue: "NO",
      comfort: "NEUTRAL",
      keepSearching: true,
      note: "not for me",
    });
    const outcome = await submitVideoFeedback({
      userId: b.id,
      videoSessionId: booked.session.id,
      wantContinue: "YES",
      comfort: "NATURAL",
      keepSearching: true,
    });

    expect(outcome.bothAnswered).toBe(true);
    expect(outcome.mutualContinue).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain("not for me");
    expect(await myFeedback(b.id, booked.session.id)).toMatchObject({ userId: b.id });
  });

  it("refuses feedback before the call has happened", async () => {
    const { booked, a } = await scheduled();
    await expect(
      submitVideoFeedback({
        userId: a.id,
        videoSessionId: booked.session.id,
        wantContinue: "YES",
        comfort: "NATURAL",
        keepSearching: true,
      }),
    ).rejects.toThrow(/hasn't finished/);
  });

  it("treats discomfort as a safety matter, and pausing as a pause", async () => {
    const { booked, a, b } = await scheduled();
    await completeVideo(booked.session.id);
    await submitVideoFeedback({
      userId: a.id,
      videoSessionId: booked.session.id,
      wantContinue: "NO",
      comfort: "UNCOMFORTABLE",
      keepSearching: false,
    });

    const report = await prisma.safetyReport.findFirstOrThrow({ where: { reporterId: a.id } });
    expect(report.reportedUserId).toBe(b.id);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("PAUSED");
  });
});

describe("contact exchange", () => {
  async function bothWantToContinue() {
    const { booked, a, b, connection } = await scheduled();
    await completeVideo(booked.session.id);
    for (const user of [a, b]) {
      await submitVideoFeedback({
        userId: user.id,
        videoSessionId: booked.session.id,
        wantContinue: "YES",
        comfort: "NATURAL",
        keepSearching: true,
      });
    }
    return { a, b, connection };
  }

  it("shares nothing until both sides have agreed", async () => {
    const { a, b, connection } = await bothWantToContinue();
    const mine = await setContactMethod({ userId: a.id, kind: "WECHAT", value: "a-wechat" });
    await setContactMethod({ userId: b.id, kind: "WECHAT", value: "b-wechat" });

    const first = await grantContactExchange({
      userId: a.id,
      connectionId: connection.id,
      contactMethodId: mine.id,
    });
    expect(first.status).toBe("WAITING_FOR_THEM");
    expect(JSON.stringify(first)).not.toContain("b-wechat");
    expect(
      (await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } })).status,
    ).not.toBe("CONTACT_EXCHANGED");
  });

  it("exchanges once both have agreed, then steps out", async () => {
    const { a, b, connection } = await bothWantToContinue();
    const mine = await setContactMethod({ userId: a.id, kind: "WECHAT", value: "a-wechat" });
    const theirs = await setContactMethod({ userId: b.id, kind: "PHONE", value: "+8613000000000" });

    await grantContactExchange({
      userId: a.id,
      connectionId: connection.id,
      contactMethodId: mine.id,
    });
    const outcome = await grantContactExchange({
      userId: b.id,
      connectionId: connection.id,
      contactMethodId: theirs.id,
    });

    expect(outcome.status).toBe("EXCHANGED");
    expect(outcome.counterpart?.value).toBe("a-wechat");
    expect(
      (await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } })).status,
    ).toBe("CONTACT_EXCHANGED");
  });

  it("will not ride on consent given for an older version of a contact detail", async () => {
    const { a, b, connection } = await bothWantToContinue();
    const mine = await setContactMethod({ userId: a.id, kind: "WECHAT", value: "a-wechat" });
    const theirs = await setContactMethod({ userId: b.id, kind: "WECHAT", value: "b-wechat" });
    await grantContactExchange({
      userId: a.id,
      connectionId: connection.id,
      contactMethodId: mine.id,
    });

    // A edits the detail after consenting: the stored consent no longer applies.
    await prisma.contactMethod.update({
      where: { id: mine.id },
      data: { value: "a-wechat-new", version: { increment: 1 } },
    });
    const outcome = await grantContactExchange({
      userId: b.id,
      connectionId: connection.id,
      contactMethodId: theirs.id,
    });
    expect(outcome.status).toBe("WAITING_FOR_THEM");
  });

  it("refuses an exchange before both said they want to keep going", async () => {
    const { booked, a, b, connection } = await scheduled();
    await completeVideo(booked.session.id);
    await submitVideoFeedback({
      userId: a.id,
      videoSessionId: booked.session.id,
      wantContinue: "YES",
      comfort: "NATURAL",
      keepSearching: true,
    });
    await submitVideoFeedback({
      userId: b.id,
      videoSessionId: booked.session.id,
      wantContinue: "NO",
      comfort: "NEUTRAL",
      keepSearching: true,
    });
    const mine = await setContactMethod({ userId: a.id, kind: "WECHAT", value: "a-wechat" });

    await expect(
      grantContactExchange({
        userId: a.id,
        connectionId: connection.id,
        contactMethodId: mine.id,
      }),
    ).rejects.toThrow(/you've both said/);
  });

  it("will not share a contact method belonging to someone else", async () => {
    const { a, b, connection } = await bothWantToContinue();
    const theirs = await setContactMethod({ userId: b.id, kind: "WECHAT", value: "b-wechat" });
    await expect(
      grantContactExchange({
        userId: a.id,
        connectionId: connection.id,
        contactMethodId: theirs.id,
      }),
    ).rejects.toThrow(/Not authorized/);
  });

  it("does not read handing over a contact detail as permission to share it", async () => {
    const turn = await new MockAIProvider().respond({
      message: "wechat: qa_demo_0921",
      recentTurns: [{ role: "user", text: "hi" }],
      knownFacts: [],
    });
    const called = turn.toolCalls.map((c) => c.name);
    expect(called).toContain("set_contact_method");
    expect(called).not.toContain("consent_contact_exchange");
  });

  it("records declining as neutral, not as a verdict on the person", async () => {
    const { a, connection } = await bothWantToContinue();
    await declineContactExchange({ userId: a.id, connectionId: connection.id });
    const event = await prisma.preferenceLearningEvent.findFirstOrThrow({
      where: { userId: a.id, eventType: "CONTACT_DECLINED" },
    });
    expect(event.signalDirection).toBe("NEUTRAL");
  });
});
