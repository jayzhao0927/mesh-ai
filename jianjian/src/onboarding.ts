import { query } from './db/db.js';

// 对话建档（规则式）：见见按固定流程一问一答，把答案写进画像 stated 轨。
// 先问连接目标，再按目标分叉；抽象词拆成选项，敏感/底线问题可跳过。
// 写入的 key 与 matching.ts 打分用的字段一致，推荐直接用得上。
// 接入 DeepSeek 后由 LLM 驱动措辞与追问，这里的步骤与写入规则保持不变。

export type Target = '稳定恋爱' | '奔着结婚认真谈';
export const TARGETS: Target[] = ['稳定恋爱', '奔着结婚认真谈'];

export interface Step {
  key: string;
  question: string;
  options: string[];
  multi?: boolean;
  allowText?: boolean;
  skippable: boolean;
  only?: Target;
}

export const STEPS: Step[] = [
  {
    key: 'target',
    question: '先聊聊你想要什么样的关系吧。我现在只帮两种认真的关系牵线，你更接近哪一种？',
    options: TARGETS,
    skippable: false,
  },
  {
    key: 'pace',
    question: '在一起之后，你理想的相处节奏更像哪种？',
    options: ['每天都想黏在一起', '常联系，也各有空间', '各忙各的，见面时很投入'],
    skippable: true,
    only: '稳定恋爱',
  },
  {
    key: 'marriage_view',
    question: '说到结婚，你现在的想法更接近哪种？',
    options: ['遇到对的人就认真推进', '先好好恋爱，水到渠成', '已经在认真规划成家'],
    skippable: true,
    only: '奔着结婚认真谈',
  },
  {
    key: 'family_view',
    question: '婚后你更期待什么样的家？',
    options: ['两个人的小家，独立自主', '和双方家人常来常往', '还没想好'],
    skippable: true,
    only: '奔着结婚认真谈',
  },
  {
    key: 'hobbies',
    question: '平时空下来，你最常做什么？可以多选，也可以自己说。',
    options: ['徒步', '攀岩', '跑步', '健身', '摄影', '阅读', '电影', '做饭', '探店', '露营', '桌游', '游戏'],
    multi: true,
    allowText: true,
    skippable: true,
  },
  {
    key: 'weekend',
    question: '一个理想的周末，你更可能在哪儿？',
    options: ['户外', '宅家', '和朋友聚', '一个人充电'],
    skippable: true,
  },
  {
    key: 'hometown',
    question: '你是哪里人？',
    options: [],
    allowText: true,
    skippable: true,
  },
  {
    key: 'occupation',
    question: '方便说说你做什么工作吗？不想说可以跳过。',
    options: [],
    allowText: true,
    skippable: true,
  },
  {
    key: 'money_view',
    question: '关于钱，你更认同哪种？这题可以跳过。',
    options: ['务实，先存再花', '该花就花，享受当下', '两个人一起规划'],
    skippable: true,
  },
  {
    key: 'vibe',
    question: '朋友一般会怎么形容你？',
    options: ['温和安静', '阳光开朗', '成熟稳重', '有点小酷'],
    skippable: true,
  },
  {
    key: 'ideal_date',
    question: '理想的第一次约会，你会选？',
    options: ['一起逛展', '安静吃顿饭', '户外走走', '看场电影'],
    skippable: true,
  },
  {
    key: 'spark',
    question: '什么时刻最容易让你来电？',
    options: ['认真听我说话', '有趣会接梗', '靠谱说到做到', '对生活有热情'],
    skippable: true,
  },
  {
    key: 'vibe_pref',
    question: '你更容易被哪种气质吸引？',
    options: ['温和安静', '阳光开朗', '成熟稳重', '有点小酷'],
    skippable: true,
  },
  {
    key: 'comm_style',
    question: '聊天的时候，你更习惯哪种方式？',
    options: ['直接坦诚', '温和委婉', '慢热但真诚', '爱开玩笑'],
    skippable: true,
  },
  {
    key: 'conflict',
    question: '两个人有分歧的时候，你通常会？',
    options: ['当下就说开', '先冷静，再好好聊', '先让一步', '写下来再沟通'],
    skippable: true,
  },
];

const TEXT_MAX = 30;
const MULTI_MAX = 8;

export interface OnboardingState {
  done: boolean;
  step: Omit<Step, 'only'> | null;
  transcript: { question: string; answer: string | null }[];
  answered: number;
  total: number;
}

interface Snapshot {
  target: Target | null;
  stated: Record<string, { value: unknown }>;
  skipped: Set<string>;
}

async function load(userId: string): Promise<Snapshot> {
  const [p, t, s] = await Promise.all([
    query<{ data: any }>('SELECT data FROM profiles WHERE user_id = $1', [userId]),
    query<{ target: Target }>('SELECT target FROM connection_targets WHERE user_id = $1', [userId]),
    query<{ step_key: string }>('SELECT step_key FROM onboarding_skips WHERE user_id = $1', [userId]),
  ]);
  return {
    target: t[0]?.target ?? null,
    stated: p[0]?.data?.stated ?? {},
    skipped: new Set(s.map((r) => r.step_key)),
  };
}

function stepsFor(target: Target | null): Step[] {
  return STEPS.filter((s) => !s.only || s.only === target);
}

function answerOf(snap: Snapshot, step: Step): string | null {
  if (step.key === 'target') return snap.target;
  const v = snap.stated[step.key]?.value;
  if (Array.isArray(v)) return v.length > 0 ? v.map(String).join('、') : null;
  return typeof v === 'string' && v ? v : null;
}

export async function getState(userId: string): Promise<OnboardingState> {
  const snap = await load(userId);
  const steps = stepsFor(snap.target);
  const transcript: OnboardingState['transcript'] = [];
  let next: Step | null = null;
  for (const step of steps) {
    const answer = answerOf(snap, step);
    if (answer !== null || snap.skipped.has(step.key)) {
      transcript.push({ question: step.question, answer });
    } else if (!next) {
      next = step;
    }
  }
  const step = next ? (({ only: _only, ...rest }) => rest)(next) : null;
  return { done: next === null, step, transcript, answered: transcript.length, total: steps.length };
}

export class OnboardingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function validate(step: Step, value: unknown): string | string[] {
  const inOptions = (x: string) => step.options.includes(x);
  const okText = (x: string) => x.length > 0 && x.length <= TEXT_MAX;
  if (step.multi) {
    if (!Array.isArray(value)) throw new OnboardingError(400, '这题可以多选，请传数组');
    const list = [...new Set(value.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
    if (list.length === 0 || list.length > MULTI_MAX) throw new OnboardingError(400, '请选择一到八项');
    for (const x of list) {
      if (!inOptions(x) && !(step.allowText && okText(x))) throw new OnboardingError(400, `「${x}」不在选项里`);
    }
    return list;
  }
  if (typeof value !== 'string' || !value.trim()) throw new OnboardingError(400, '回答不能为空');
  const v = value.trim();
  if (inOptions(v)) return v;
  if (step.allowText && okText(v)) return v;
  throw new OnboardingError(400, step.allowText ? '回答太长了，简短说说就好' : `「${v}」不在选项里`);
}

/** 回答当前这一题（只接受当前题，按顺序走，不跳着写） */
export async function answer(userId: string, key: string, input: { value?: unknown; skip?: boolean }): Promise<OnboardingState> {
  const state = await getState(userId);
  if (state.done || !state.step) throw new OnboardingError(409, '建档已经完成');
  const step = STEPS.find((s) => s.key === state.step!.key)!;
  if (key !== step.key) throw new OnboardingError(409, '请先回答当前这一题');

  if (input.skip) {
    if (!step.skippable) throw new OnboardingError(400, '这一题需要选一个，才能帮你找对的人');
    await query(
      'INSERT INTO onboarding_skips (user_id, step_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, step.key],
    );
    return getState(userId);
  }

  const value = validate(step, input.value);
  if (step.key === 'target') {
    await query(
      `INSERT INTO connection_targets (user_id, target, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET target = $2, updated_at = now()`,
      [userId, value],
    );
  } else {
    const entry = { value, source: 'user', confidence: 1, updated_at: new Date().toISOString(), via: 'onboarding' };
    await query(
      `INSERT INTO profiles (user_id, data, updated_at)
       VALUES ($1, jsonb_build_object('stated', jsonb_build_object($2::text, $3::jsonb), 'revealed', '{}'::jsonb), now())
       ON CONFLICT (user_id) DO UPDATE SET
         data = jsonb_set(
           CASE WHEN jsonb_typeof(profiles.data->'stated') = 'object' THEN profiles.data
                ELSE jsonb_set(COALESCE(profiles.data, '{}'::jsonb), '{stated}', '{}'::jsonb) END,
           ARRAY['stated', $2::text], $3::jsonb),
         updated_at = now()`,
      [userId, step.key, JSON.stringify(entry)],
    );
  }
  await query('DELETE FROM onboarding_skips WHERE user_id = $1 AND step_key = $2', [userId, step.key]);
  return getState(userId);
}
