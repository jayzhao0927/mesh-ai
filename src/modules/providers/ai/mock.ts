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
    pattern:
      /(?:我(?:平时)?(?:喜欢|爱)|i (?:love|enjoy) )\s*(攀岩|跑步|摄影|写作|做饭|音乐|旅行|咖啡|climbing|running|photography|writing|cooking|music|travel|coffee|hiking|food)/i,
    build: (m, text) => ({
      category: "interest",
      key: "topic",
      value: INTEREST_CANON[(m[1] ?? "").toLowerCase()] ?? (m[1] ?? "").toLowerCase(),
      confidence: 0.7,
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

/** Maps the phrases the mock understands onto the demo pool's vocabulary. */
const INTEREST_CANON: Record<string, string> = {
  攀岩: "climbing",
  跑步: "running",
  摄影: "photography",
  写作: "writing",
  做饭: "food",
  音乐: "music",
  旅行: "travel",
  咖啡: "coffee",
  cooking: "food",
};

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
    if (/(帮我找|介绍|认识(?:个|一个)?人|find (?:me )?someone|introduce)/i.test(text)) {
      toolCalls.push({ name: "find_next_connection", args: {} });
    }
    // Order matters: a refusal contains the same words as an acceptance.
    if (/(不感兴趣|不合适|不想认识|算了|pass|not interested)/i.test(text)) {
      toolCalls.push({ name: "respond_to_recommendation", args: { state: "NOT_INTERESTED" } });
    } else if (/(以后再说|过段时间|再说吧|later|not now)/i.test(text)) {
      toolCalls.push({ name: "respond_to_recommendation", args: { state: "LATER" } });
    } else if (/(感兴趣|想认识|见一面|安排吧|\byes\b|interested)/i.test(text)) {
      toolCalls.push({ name: "respond_to_recommendation", args: { state: "INTERESTED" } });
    }
    if (/(暂停|pause)/i.test(text)) toolCalls.push({ name: "pause_connections", args: {} });
    if (/(继续找|恢复|resume)/i.test(text)) toolCalls.push({ name: "resume_connections", args: {} });
    if (/(你记住了我什么|what do you (know|remember))/i.test(text)) {
      toolCalls.push({ name: "get_relationship_profile", args: {} });
    }
    if (/(你觉得我喜欢什么|你学到了什么|what have you learned|learned about me)/i.test(text)) {
      toolCalls.push({ name: "get_learned_preferences", args: {} });
    }
    if (/(这个判断不对|不是稳定偏好|别这么想|that'?s not (right|me)|drop that)/i.test(text)) {
      toolCalls.push({ name: "correct_preference_hypothesis", args: { correction: "REJECT" } });
    } else if (/(说得对|确实是这样|you'?re right about that)/i.test(text)) {
      toolCalls.push({ name: "correct_preference_hypothesis", args: { correction: "CONFIRM" } });
    } else if (/(说不好|不确定|not sure about that)/i.test(text)) {
      toolCalls.push({ name: "correct_preference_hypothesis", args: { correction: "UNSURE" } });
    }

    // Phase 4: scheduling, post-video feedback and contact exchange.
    if (/(安排视频|视频时间|什么时候视频|schedule (a )?(video|call)|video times)/i.test(text)) {
      toolCalls.push({ name: "propose_video_times", args: {} });
    }
    const slot = text.match(/(?:第\s*([一二三123])\s*(?:个|场)?|slot\s*([123])|option\s*([123]))/i);
    if (slot) {
      const raw = slot[1] ?? slot[2] ?? slot[3] ?? "1";
      const index = ({ 一: 1, 二: 2, 三: 3 } as Record<string, number>)[raw] ?? Number(raw);
      toolCalls.push({ name: "schedule_video", args: { slotIndex: index - 1 } });
    }
    if (/(不太舒服|不舒服|uncomfortable)/i.test(text)) {
      toolCalls.push({
        name: "submit_video_feedback",
        args: { wantContinue: "NO", comfort: "UNCOMFORTABLE", keepSearching: true },
      });
    } else if (/(想继续认识|愿意继续|还想继续|want to continue|keep going)/i.test(text)) {
      toolCalls.push({
        name: "submit_video_feedback",
        args: { wantContinue: "YES", comfort: "NATURAL", keepSearching: true },
      });
    } else if (/(不想继续|不用继续了|don'?t want to continue)/i.test(text)) {
      toolCalls.push({
        name: "submit_video_feedback",
        args: { wantContinue: "NO", comfort: "NEUTRAL", keepSearching: true },
      });
    }
    const contact = text.match(
      /(?:微信(?:号)?(?:是|：|:)?\s*([A-Za-z0-9_-]{4,40})|wechat[:：]?\s*([A-Za-z0-9_-]{4,40})|(?:手机号|电话)(?:是|：|:)?\s*(\+?[\d][\d\s-]{5,20}))/i,
    );
    if (contact) {
      const wechat = contact[1] ?? contact[2];
      toolCalls.push({
        name: "set_contact_method",
        args: wechat
          ? { kind: "WECHAT", value: wechat }
          : { kind: "PHONE", value: (contact[3] ?? "").trim() },
      });
    }
    if (/(先不换|暂时不换|不交换联系方式|not yet)/i.test(text)) {
      toolCalls.push({ name: "decline_contact_exchange", args: {} });
    } else if (/(同意交换|交换联系方式|可以给他|可以给她|exchange contact)/i.test(text) || contact) {
      toolCalls.push({ name: "consent_contact_exchange", args: {} });
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
