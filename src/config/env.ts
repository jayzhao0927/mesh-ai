import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MESSAGING_PROVIDER: z.enum(["mock", "photon", "web_fallback"]).default("mock"),
  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  VIDEO_PROVIDER: z.enum(["mock"]).default("mock"),
  VERIFICATION_PROVIDER: z.enum(["mock"]).default("mock"),
  AGENT_PHONE_NUMBER: z.string().default(""),
  /** Origin used when the Agent sends a link over messaging. */
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  PHOTON_API_BASE_URL: z.string().default(""),
  PHOTON_API_KEY: z.string().default(""),
  PHOTON_WEBHOOK_SECRET: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  ENABLE_DEV_CHAT: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  /** Whether real users may be introduced to seeded demo profiles. */
  MATCH_WITH_DEMO_USERS: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    cached = schema.parse(process.env);
  }
  return cached;
}

/** Debug surfaces are only ever reachable outside production. */
export function devChatEnabled(): boolean {
  const e = env();
  return e.ENABLE_DEV_CHAT && e.NODE_ENV !== "production";
}
