/** A signal the model proposes; it is a hypothesis until a tool validates and
 *  the user confirms it. Never written straight to the database. */
export interface ProposedSignal {
  category: string;
  key: string;
  value: string;
  confidence: number;
  evidenceQuote?: string;
  /** Only user-stated facts are matchable without further confirmation. */
  source: "USER_STATED" | "AI_INFERENCE";
}

export interface AgentTurnInput {
  /** Bounded recent turns, never the full SMS history. */
  recentTurns: { role: "user" | "agent"; text: string }[];
  /** Long-term summary of the relationship profile. */
  summary?: string;
  /** Structured, already confirmed facts. */
  knownFacts: { key: string; value: string }[];
  message: string;
}

export interface AgentTurnOutput {
  reply: string;
  proposedSignals: ProposedSignal[];
  /** Requests a domain action; the runtime validates and authorizes it. */
  toolCalls: { name: string; args: Record<string, unknown> }[];
}

export interface AIProvider {
  readonly name: string;
  respond(input: AgentTurnInput): Promise<AgentTurnOutput>;
}
