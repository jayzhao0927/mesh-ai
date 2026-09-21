import { NotImplementedByProvider } from "@/modules/shared/errors";
import type { AIProvider, AgentTurnOutput } from "./types";

/**
 * Declared, not connected. Sending user content to a third-party model also
 * requires THIRD_PARTY_PROCESSING consent, which the runtime checks before it
 * would ever select this provider.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  async respond(): Promise<AgentTurnOutput> {
    throw new NotImplementedByProvider("OpenAIProvider", "respond");
  }
}
