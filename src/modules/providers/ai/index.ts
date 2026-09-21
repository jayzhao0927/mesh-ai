import { env } from "@/config/env";
import { MockAIProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./types";

let instance: AIProvider | null = null;

export function aiProvider(): AIProvider {
  if (instance) return instance;
  instance = env().AI_PROVIDER === "openai" ? new OpenAIProvider() : new MockAIProvider();
  return instance;
}

export function resetAIProvider(): void {
  instance = null;
}

export * from "./types";
