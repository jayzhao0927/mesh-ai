import { PrismaClient, type ConnectionIntentType } from "@prisma/client";

const prisma = new PrismaClient();

interface DemoProfile {
  key: string;
  displayName: string;
  ageYears: number;
  city: string;
  languages: string[];
  bio: string;
  intent: ConnectionIntentType;
  interests: string[];
  values: string[];
}

/**
 * Demo profiles for the connection pool. Every row is flagged isDemo so it can
 * never be mistaken for, or mixed into, the real user base.
 */
const profiles: DemoProfile[] = [
  {
    key: "demo-lin",
    displayName: "Lin",
    ageYears: 29,
    city: "上海",
    languages: ["zh", "en"],
    bio: "Product designer who spends weekends climbing and rebuilding film cameras.",
    intent: "DATING",
    interests: ["climbing", "photography", "design"],
    values: ["直接沟通"],
  },
  {
    key: "demo-wei",
    displayName: "Wei",
    ageYears: 32,
    city: "上海",
    languages: ["zh"],
    bio: "Backend engineer, long-distance runner, quietly writing a novel nobody has read.",
    intent: "MARRIAGE",
    interests: ["running", "writing", "coffee"],
    values: ["家庭"],
  },
  {
    key: "demo-mika",
    displayName: "Mika",
    ageYears: 27,
    city: "上海",
    languages: ["zh", "en", "ja"],
    bio: "Documentary editor. Will talk about food markets for longer than is reasonable.",
    intent: "DATING",
    interests: ["photography", "food", "travel"],
    values: ["好奇心"],
  },
  {
    key: "demo-chen",
    displayName: "Chen",
    ageYears: 34,
    city: "北京",
    languages: ["zh", "en"],
    bio: "Left consulting to start a small ceramics studio. Still an early riser.",
    intent: "MARRIAGE",
    interests: ["ceramics", "hiking", "coffee"],
    values: ["家庭"],
  },
  {
    key: "demo-ana",
    displayName: "Ana",
    ageYears: 30,
    city: "北京",
    languages: ["en", "es"],
    bio: "Climate researcher, new in town, looking for people to hike with on weekends.",
    intent: "FRIENDSHIP",
    interests: ["hiking", "climbing", "science"],
    values: ["好奇心"],
  },
  {
    key: "demo-jun",
    displayName: "Jun",
    ageYears: 28,
    city: "深圳",
    languages: ["zh", "en"],
    bio: "Hardware engineer who cooks for ten people whenever he gets the chance.",
    intent: "DATING",
    interests: ["food", "music", "running"],
    values: ["直接沟通"],
  },
  {
    key: "demo-sara",
    displayName: "Sara",
    ageYears: 31,
    city: "深圳",
    languages: ["en", "zh"],
    bio: "Teacher and part-time jazz pianist, allergic to small talk.",
    intent: "MEANINGFUL_CONNECTION",
    interests: ["music", "writing", "travel"],
    values: ["直接沟通"],
  },
  {
    key: "demo-tao",
    displayName: "Tao",
    ageYears: 35,
    city: "上海",
    languages: ["zh"],
    bio: "Runs a bookshop café. Reads far more than he sells.",
    intent: "MARRIAGE",
    interests: ["coffee", "writing", "food"],
    values: ["家庭"],
  },
];

async function main() {
  const now = new Date();
  for (const profile of profiles) {
    const identity = await prisma.messagingIdentity.findUnique({
      where: { provider_externalId: { provider: "MOCK", externalId: profile.key } },
    });

    const user = identity
      ? await prisma.user.update({
          where: { id: identity.userId },
          data: {
            displayName: profile.displayName,
            ageYears: profile.ageYears,
            city: profile.city,
            languages: profile.languages,
            bio: profile.bio,
            isDemo: true,
            status: "ACTIVE",
            verifiedAt: now,
            poolEligibleAt: now,
          },
        })
      : await prisma.user.create({
          data: {
            displayName: profile.displayName,
            ageYears: profile.ageYears,
            city: profile.city,
            languages: profile.languages,
            bio: profile.bio,
            isDemo: true,
            verifiedAt: now,
            poolEligibleAt: now,
            messagingIdentities: {
              create: { provider: "MOCK", channel: "IMESSAGE", externalId: profile.key },
            },
            relationshipProfile: { create: { summary: profile.bio } },
          },
        });

    await prisma.connectionIntent.deleteMany({ where: { userId: user.id } });
    await prisma.connectionIntent.create({
      data: { userId: user.id, intent: profile.intent },
    });

    // Demo signals are pre-confirmed: these profiles stand in for users who
    // already told their Agent these things.
    await prisma.relationshipSignal.deleteMany({ where: { userId: user.id } });
    const signals = [
      ...profile.interests.map((value) => ({ category: "interest", key: "topic", value })),
      ...profile.values.map((value) => ({ category: "values", key: "value", value })),
    ];
    for (const signal of signals) {
      await prisma.relationshipSignal.create({
        data: {
          userId: user.id,
          ...signal,
          source: "USER_STATED",
          confidence: 0.9,
          userConfirmed: true,
          matchable: true,
          reviewStatus: "CONFIRMED",
        },
      });
    }
  }
  console.log(`Seeded ${profiles.length} demo profiles (isDemo = true).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
