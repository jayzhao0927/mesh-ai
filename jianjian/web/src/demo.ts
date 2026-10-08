import type { OnboardingStep, OnboardingState, ProfileResponse, Target } from './api';
const TARGETS: Target[] = ['稳定恋爱', '奔着结婚认真谈'];
const STEPS: (OnboardingStep & { only?: Target })[] = [
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
const KEY = 'jj.try.state';
interface State { agentName: string; profile: ProfileResponse; skips: string[]; choice: 'interested' | 'pass' | null; mutual: boolean; createdAt: string; invites: unknown[] }
const blank = (): State => ({ agentName: '见见', profile: { data: { stated: {}, revealed: {} }, target: null }, skips: [], choice: null, mutual: false, createdAt: new Date().toISOString(), invites: [] });
function load(): State { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || blank(); } catch { return blank(); } }
function save(s: State) { localStorage.setItem(KEY, JSON.stringify(s)); }
function onboarding(s: State): OnboardingState {
 const steps = STEPS.filter(x => !x.only || x.only === s.profile.target);
 const transcript: OnboardingState['transcript'] = [];
 let step: OnboardingStep | null = null;
 for (const x of steps) {
  const value = x.key === 'target' ? s.profile.target : s.profile.data.stated[x.key]?.value;
  if (value !== undefined && value !== null && value !== '') transcript.push({ question: x.question, answer: Array.isArray(value) ? value.join('、') : String(value) });
  else if (s.skips.includes(x.key)) transcript.push({ question: x.question, answer: null });
  else if (!step) step = x;
 }
 return { done: !step, step, transcript, answered: transcript.length, total: steps.length };
}
function rec(s: State) {
 return { id: 'sample-rec', candidate_snapshot: { stated: { occupation: { value: '设计师' }, hobbies: { value: ['徒步', '摄影', '做饭'] }, vibe: { value: '温和，也有好奇心' } } }, reasons: ['你们都愿意把关系认真放进生活里', '你喜欢安静的陪伴，TA 也懂得给彼此空间', 'AI 推演样例：意见不同时，你们先听完对方，再寻找共同安排'], link: '/s/rec/sample-token', status: s.mutual ? 'mutual' : 'pending', myChoice: s.choice, created_at: s.createdAt };
}
export function resetDemo() { localStorage.removeItem(KEY); localStorage.removeItem('jj.try.day'); localStorage.removeItem('jj.try.basic-skips'); }
export function demoMutual() { const s = load(); s.mutual = true; save(s); }
export async function demoRequest(method: string, path: string, input?: unknown): Promise<unknown> {
 const s = load(); const body = (input || {}) as Record<string, any>;
 if (path === '/api/auth/dev-token') return { token: 'local-sample-token', userId: 'local-sample-user' };
 if (path === '/api/settings') { if (method === 'PUT') { s.agentName = body.agentName; save(s); } return { agentName: s.agentName }; }
 if (path === '/api/profile') { if (method === 'PUT') { if (body.data) s.profile.data = body.data; if (body.target) s.profile.target = body.target; save(s); } return s.profile; }
 if (method === 'DELETE' && path.startsWith('/api/profile/')) { const [, , , track, key] = path.split('/'); delete (s.profile.data as any)[track][decodeURIComponent(key)]; save(s); return { ok: true }; }
 if (path === '/api/onboarding') return onboarding(s);
 if (path === '/api/onboarding/answer') {
  if (body.skip) s.skips.push(body.key);
  else if (body.key === 'target') s.profile.target = body.value;
  else s.profile.data.stated[body.key] = { value: body.value, source: 'user', confidence: 1 };
  save(s); return onboarding(s);
 }
 if (path === '/api/recommendations/generate') { s.createdAt = new Date().toISOString(); save(s); return { id: 'sample-rec', link: '/s/rec/sample-token' }; }
 if (path === '/api/recommendations/current' || path.startsWith('/api/recommendations/by-token/')) return { ...rec(s), role: 'viewer' };
 if (path === '/api/recommendations/incoming') return { token: 'sample-token' };
 if (path.endsWith('/intent')) { s.choice = body.choice; save(s); return { ok: true, mutual: s.mutual }; }
 if (path === '/api/video/rooms') return { roomId: 'sample-room', link: '/s/video/sample-room', userSig: 'stub-sample' };
 if (path.startsWith('/v/')) return { roomId: 'sample-room', userSig: 'stub-sample' };
 if (path === '/api/chat') {
  if (body.message === '继续匹配') return { reply: '好，我会继续为你寻找合适的人。' };
  return { reply: '我听见了。这个样例只能体验页面流程，自由对话要接通真实 AI 后才会理解你的表达。' };
 }
 if (path === '/api/invites') { if (method === 'POST') { s.invites.push({ id: crypto.randomUUID(), kind: body.kind, status: 'sent', created_at: new Date().toISOString() }); save(s); } return method === 'GET' ? s.invites : { ok: true }; }
 if (path === '/api/invites/inbox') return [];
 throw new Error('这个功能还没有开放样例体验');
}
