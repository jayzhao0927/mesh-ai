import type { AIProvider, AgentTurnInput, AgentTurnOutput, ProposedSignal } from "./types";

interface Rule {
  pattern: RegExp;
  build: (match: RegExpMatchArray, text: string) => ProposedSignal;
}

const rules: Rule[] = [
  {
    pattern: /(?:我|i am|i'm)\s*(\d{2})\s*(?:岁|years old|yo)/i,
    build: (m, text) => ({
      category: "identity",
      key: "age",
      value: m[1],
      confidence: 0.9,
      evidenceQuote: text,
      source: "USER_STATED",
    }),
  },
  {
    pattern:
      /(?:我(?:现在)?(?:住在|搬到|在))\s*([\u4e00-\u9fa5]{2,6}?)(?=了|，|。|$)|(?:i (?:live|moved) (?:in|to) )([a-z\s]{2,20})/i,
    build: (m, text) => ({
      category: "identity",
      key: "city",
      value: (m[1] ?? m[2] ?? "").trim(),
      confidence: 0.75,
      evidenceQuote: text,
      source: "USER_STATED",
    }),
  },
  {
    pattern: /(不考虑|不接受)\s*异地|no long[- ]distance/i,
    build: (_m, text) => ({
      category: "boundary",
      key: "long_distance",
      value: "not_open",
      confidence: 0.85,
      evidenceQuote: text,
      source: "USER_STATED",
    }),
  },
  {
    pattern: /(我喜欢|我想找|i (?:like|want|am looking for))\s*(.{2,40})/i,
    build: (m, text) => ({
      category: "stated_preference",
      key: "partner_trait",
      value: (m[2] ?? "").trim(),
      confidence: 0.6,
      evidenceQuote: text,
      source: "USER_STATED",
    }),
  },
  {
    pattern: /(换了?工作|换工作|new job|changed jobs)/i,
    build: (_m, text) => ({
      category: "lifestyle",
      key: "job_change",
      value: "recent",
      confidence: 0.7,
      evidenceQuote: text,
      source: "USER_STATED",
    }),
  },
];

const INTENT_RULES: { pattern: RegExp; intent: string }[] = [
  { pattern: /(找对象|恋爱|dating)/i, intent: "DATING" },
  { pattern: /(结婚|marriage)/i, intent: "MARRIAGE" },
  { pattern: /(交朋友|朋友|friendship)/i, intent: "FRIENDSHIP" },
];

/**
 * Deterministic stand-in for a real LLM. It keeps local development free of AI
 * credentials and makes tests reproducible. It is explicitly NOT a language
 * model: it pattern-matches a handful of onboarding phrases.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async respond(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const text = input.message.trim();
    const proposedSignals: ProposedSignal[] = [];
    for (const rule of rules) {
      const match = text.match(rule.pattern);
      if (match) {
        const signal = rule.build(match, text);
        if (signal.value) proposedSignals.push(signal);
      }
    }

    const toolCalls: AgentTurnOutput["toolCalls"] = [];
    for (const { pattern, intent } of INTENT_RULES) {
      if (pattern.test(text)) {
        toolCalls.push({ name: "set_connection_intent", args: { intent } });
        break;
      }
    }
    if (/(暂停|pause)/i.test(text)) toolCalls.push({ name: "pause_connections", args: {} });
    if (/(继续找|恢复|resume)/i.test(text)) toolCalls.push({ name: "resume_connections", args: {} });
    if (/(你记住了我什么|what do you (know|remember))/i.test(text)) {
      toolCalls.push({ name: "get_relationship_profile", args: {} });
    }

    return { reply: buildReply(text, proposedSignals, input), proposedSignals, toolCalls };
  }
}

function buildReply(
  text: string,
  signals: ProposedSignal[],
  input: AgentTurnInput,
): string {
  if (input.recentTurns.length === 0) {
    return "Hi, I'm your MESH Agent. I'd like to understand who you are before I introduce anyone. What's keeping you busy these days?";
  }
  if (/(你记住了我什么|what do you (know|remember))/i.test(text)) {
    return input.knownFacts.length
      ? `Here's what I've got so far: ${input.knownFacts
          .map((f) => `${f.key}: ${f.value}`)
          .join("; ")}. Tell me if any of that is off.`
      : "Nothing confirmed yet — I'd rather ask than guess. Where are you based these days?";
  }
  if (/(不对|不是|that's wrong|not right)/i.test(text)) {
    return "Got it — I won't treat that as a stable preference, I'll keep observing.";
  }
  if (signals.length) {
    return `Noted: ${signals
      .map((s) => `${s.key} = ${s.value}`)
      .join(", ")}. Did I get that right?`;
  }
  return "That's useful, thanks. What matters most to you in the people you'd like to meet?";
}
