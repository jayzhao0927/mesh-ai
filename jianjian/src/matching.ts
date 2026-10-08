import { query } from './db/db.js';
import { ACTIVE_RECOMMENDATION_SQL } from './recommendation-lifecycle.js';

// 匹配模块 v1：p_mutual dyad 打分（冷启动阶段，加权规则版）
// 唯一优化目标：一次推荐后，两个人双向愿意继续的概率。
//
// 流程：硬过滤（SQL：目标对齐 / 30 天不重推 / 排除自己）→ 召回候选池 →
//   对每个 dyad 分别预测 p(A→B)、p(B→A) → 调和平均合成 p_mutual →
//   80% 取最高分，20% 探索（不确定但值得试）→ 四项分值记入 score_breakdown。
//
// 四分量：对齐度（地基）+ 化学反应先验 + 互惠（调和平均结构：单边高分被惩罚）+ 探索 bonus。
// 数字只进打分，永远不出现在推荐卡/理由/候选列表（见 buildReasons 的数字过滤）。
// 八字不进匹配系统（2026-10-04 决策）。
//
// 底色（潜在特质）推断（2026-10-06）：Allen Wang 访谈的启示——
// 表面爱好不同，深层底色可能一致（攀岩 vs 越野 → 都是冒险型）；
// 静态画像字段预测不了 chemistry，要找的是每个人的底色。
// v1 用关键词词典做确定性推断（可测、零成本）；画像写入管线（任务 2）落地后，
// 改为 LLM 在写入时推断并存入 revealed.traits —— getTraits 已优先读 revealed.traits，
// 届时只需把推断前移到写入时，匹配侧不用改。

const SCORE_VERSION = 'p_mutual-v1';
const RECALL_LIMIT = 50;
const EXPLORE_RATE = 0.2; // 约 20% 的推荐用于探索

// 打分用到的画像信号键（缺失则该项记 0，不扣分；不确定性计入探索 bonus）
const SIGNAL_KEYS = [
  'hometown',
  'hobbies',
  'money_view',
  'weekend',
  'comm_style',
  'ideal_date',
  'vibe',
  'occupation',
];

interface ProfileField {
  value: unknown;
  confidence: number;
}

interface Candidate {
  id: string;
  nickname: string;
  target: string | null;
  profile: any;
}

export interface ScoreBreakdown {
  version: string;
  p_ab: number;
  p_ba: number;
  p_mutual: number;
  alignment_ab: number;
  chemistry_ab: number;
  alignment_ba: number;
  chemistry_ba: number;
  traits_ab: string[];
  traits_ba: string[];
  explored: boolean;
  candidate_pool: number;
}

// ---- 底色（潜在特质）----
export interface TraitScore {
  trait: string;
  score: number; // 0..1：该底色在用户爱好中的占比
}

// v1 启发式词典：爱好关键词 → 底色（多标签，一个爱好可投多票）。
// 中文爱好词太野，词典永远跟不上——这是占位实现，LLM 版在任务 2 落地时替换。
const TRAIT_KEYWORDS: Record<string, string[]> = {
  '冒险': ['攀岩', '越野', '滑雪', '冲浪', '跳伞', '蹦极', '潜水', '登山', '徒步', '探险', '漂流', '滑翔', '攀登', '溯溪'],
  '文艺': ['电影', '历史', '阅读', '读书', '音乐', '展览', '话剧', '摄影', '写作', '画画', '诗歌', '博物馆', '戏剧', '书法'],
  '居家': ['做饭', '烘焙', '园艺', '拼图', '追剧', '煲剧', '养花', '烹饪', '织毛衣'],
  '社交': ['桌游', '聚会', 'KTV', '剧本杀', '飞盘', '轰趴', '派对', '交友', '密室'],
  '运动': ['跑步', '健身', '游泳', '羽毛球', '篮球', '足球', '瑜伽', '网球', '骑行', '马拉松', '滑板'],
  '自然': ['露营', '钓鱼', '观鸟', '房车', '远足', '徒步', '登山', '观星', '溯溪'],
  '美食': ['探店', '火锅', '咖啡', '喝茶', '茶艺', '美食', '精酿', '厨艺'],
  '极客': ['编程', '数码', '游戏', '科幻', '动漫', '开源'],
};

/** 爱好列表 → 底色分布（纯函数，可测；LLM 版保持同一签名） */
export function inferTraits(hobbies: string[]): TraitScore[] {
  const clean = hobbies.filter((h) => typeof h === 'string' && h.length > 0);
  if (clean.length === 0) return [];
  const votes = new Map<string, number>();
  for (const h of clean) {
    for (const [trait, kws] of Object.entries(TRAIT_KEYWORDS)) {
      const hit = kws.some((k) => h.includes(k) || (h.length >= 2 && k.includes(h)));
      if (hit) votes.set(trait, (votes.get(trait) ?? 0) + 1);
    }
  }
  return [...votes.entries()]
    .map(([trait, v]) => ({ trait, score: Math.round((v / clean.length) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

/** 加权 Jaccard：两组底色分布的相似度 0..1 */
function traitOverlapScore(a: TraitScore[], b: TraitScore[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const mb = new Map(b.map((t) => [t.trait, t.score] as const));
  let num = 0;
  let den = 0;
  const seen = new Set<string>();
  for (const t of a) {
    const sb = mb.get(t.trait) ?? 0;
    num += Math.min(t.score, sb);
    den += Math.max(t.score, sb);
    seen.add(t.trait);
  }
  for (const t of b) {
    if (!seen.has(t.trait)) den += t.score;
  }
  return den === 0 ? 0 : num / den;
}

/** 读底色：优先 revealed.traits（未来 LLM 写入时），否则从 stated.hobbies 现场推断 */
function getTraits(profile: any): { traits: TraitScore[]; confidence: number } {
  const stored = field(profile, 'traits');
  if (stored && Array.isArray(stored.value)) {
    const names = (stored.value as unknown[]).filter((x): x is string => typeof x === 'string');
    if (names.length > 0) {
      return { traits: names.map((trait) => ({ trait, score: 1 })), confidence: stored.confidence };
    }
  }
  return { traits: inferTraits(arrVal(field(profile, 'hobbies'))), confidence: 0.6 };
}

// 注意：现实层数字字段（收入档位/身高）只进 dyad 打分的置信度参考，
// 永远不出现在推荐卡、推荐理由、候选列表（buildReasons 用正则硬过滤所有数字）。

function field(profile: any, key: string): ProfileField | null {
  const f = profile?.stated?.[key] ?? profile?.revealed?.[key];
  if (f == null || typeof f !== 'object') return null;
  const v = (f as any).value;
  if (v == null || v === '') return null;
  const c = Number((f as any).confidence);
  return { value: v, confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5 };
}

function strVal(f: ProfileField | null): string | null {
  return typeof f?.value === 'string' ? f.value : null;
}

function arrVal(f: ProfileField | null): string[] {
  return Array.isArray(f?.value) ? (f.value as unknown[]).filter((x) => typeof x === 'string') as string[] : [];
}

/** 两人某字段相等 → 按双方置信度加权返回 0..1，否则 0 */
function eqScore(a: ProfileField | null, b: ProfileField | null): number {
  const va = strVal(a);
  const vb = strVal(b);
  if (!va || !vb) return 0;
  return va === vb ? Math.min(a!.confidence, b!.confidence) : 0;
}

/** 数组交集比例 0..1（按双方置信度加权） */
function overlapScore(a: ProfileField | null, b: ProfileField | null): number {
  const la = arrVal(a);
  const lb = arrVal(b);
  if (la.length === 0 || lb.length === 0) return 0;
  const common = la.filter((x) => lb.includes(x)).length;
  if (common === 0) return 0;
  const ratio = common / Math.max(la.length, lb.length);
  return ratio * Math.min(a!.confidence, b!.confidence);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * 对齐度 A→B（地基）：目标已硬过滤给 0.30 基线；价值观/现实层逐项加权。
 * 缺失字段不扣分（返回 0），画像越全天然分越高——这是合理的：信息多 → 预测更准。
 */
function alignmentScore(viewer: any, candidate: any): number {
  let s = 0.3;
  s += 0.15 * eqScore(field(viewer, 'money_view'), field(candidate, 'money_view'));
  s += 0.12 * eqScore(field(viewer, 'hometown'), field(candidate, 'hometown'));
  // 表面爱好重合（降权：表面相同不如底色一致）
  s += 0.06 * overlapScore(field(viewer, 'hobbies'), field(candidate, 'hobbies'));
  // 底色一致：攀岩 vs 越野表面不同，但都是冒险型 → 加分
  const ta = getTraits(viewer);
  const tb = getTraits(candidate);
  s += 0.12 * traitOverlapScore(ta.traits, tb.traits) * Math.min(ta.confidence, tb.confidence);
  s += 0.08 * overlapScore(field(viewer, 'weekend'), field(candidate, 'weekend'));
  return clamp01(s);
}

/**
 * 化学反应先验 A→B：沟通风格匹配 + 约会/气质偏好 + 有张力的差异项。
 * 静态问卷预测不了来电，这里只是先验——真正的 chemistry 靠推荐后反馈与视频复盘回流。
 */
function chemistryScore(viewer: any, candidate: any): number {
  let s = 0;
  const csA = strVal(field(viewer, 'comm_style'));
  const csB = strVal(field(candidate, 'comm_style'));
  if (csA && csB) {
    const conf = Math.min(field(viewer, 'comm_style')!.confidence, field(candidate, 'comm_style')!.confidence);
    s += (csA === csB ? 0.12 : 0.05) * conf;
  }
  s += 0.1 * eqScore(field(viewer, 'ideal_date'), field(candidate, 'ideal_date'));
  s += 0.08 * eqScore(field(viewer, 'vibe'), field(candidate, 'vibe'));
  // 有张力的差异：爱好有交集但周末画风不同 → 互补新鲜感
  const hobbyOverlap = overlapScore(field(viewer, 'hobbies'), field(candidate, 'hobbies'));
  const weekendOverlap = overlapScore(field(viewer, 'weekend'), field(candidate, 'weekend'));
  if (hobbyOverlap > 0 && weekendOverlap === 0 && strVal(field(viewer, 'weekend')) && strVal(field(candidate, 'weekend'))) {
    s += 0.05;
  }
  // revealed 行为信号：如果 B 的 revealed 轨对 A 拥有的特质表达过正向 valence，加分
  s += 0.05 * revealedValenceBonus(candidate, viewer);
  return clamp01(s);
}

// revealed 行为 valence（v1 占位）：行为数据不足时返回 0；
// 第二阶段有视频复盘标签后，按"B 对 A 拥有特质的正向 valence"加分。
function revealedValenceBonus(_candidateProfile: any, _viewerProfile: any): number {
  return 0;
}

/** 单边兴趣 A→B */
function oneWayScore(viewer: any, candidate: any): { p: number; alignment: number; chemistry: number } {
  const alignment = alignmentScore(viewer, candidate);
  const chemistry = chemistryScore(viewer, candidate);
  return { p: clamp01(0.6 * alignment + 0.4 * chemistry), alignment, chemistry };
}

/** 调和平均：两边都得高分才行，单边舔狗直接出局 */
function harmonicMean(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return (2 * a * b) / (a + b);
}

/** 画像完整度 0..1：用于探索 bonus 的不确定性估计 */
function completeness(profile: any): number {
  let known = 0;
  for (const k of SIGNAL_KEYS) {
    if (field(profile, k)) known += 1;
  }
  return known / SIGNAL_KEYS.length;
}

// 推荐卡只展示对方亲口说的、非现实层的字段；revealed 推断、置信度不出卡，含数字的值整条不出
const DISPLAY_KEYS = ['hometown', 'hobbies', 'occupation', 'vibe', 'weekend', 'ideal_date', 'comm_style'];
const DIGIT_RE = /\p{Decimal_Number}/u;

export function containsDigit(text: string): boolean {
  return DIGIT_RE.test(text);
}

/** 硬规则兜底：任何要展示的文本含数字直接抛错，绝不放行 */
export function assertNoDigits(texts: string[]): void {
  const bad = texts.find(containsDigit);
  if (bad !== undefined) throw new Error(`推荐展示内容不得包含数字：${bad}`);
}

/** Revalidate stored display material too, including snapshots created before this guard. */
export function sanitizeReasons(reasons: unknown): string[] {
  const clean = Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === 'string' && reason.trim() !== '' && !containsDigit(reason))
    : [];
  if (clean.length === 0) clean.push('你们的生活节奏和期待的连接方式很合拍');
  assertNoDigits(clean);
  return clean;
}

export function sanitizeSnapshot(profile: any): { stated: Record<string, { value: string | string[] }>; revealed: Record<string, never> } {
  const stated: Record<string, { value: string | string[] }> = {};
  for (const key of DISPLAY_KEYS) {
    const v = profile?.stated?.[key]?.value;
    if (typeof v === 'string') {
      if (v.trim() && !containsDigit(v)) stated[key] = { value: v.trim() };
    } else if (Array.isArray(v)) {
      const clean = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '' && !containsDigit(x));
      if (clean.length > 0) stated[key] = { value: clean };
    }
  }
  assertNoDigits(Object.values(stated).flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value])));
  return { stated, revealed: {} };
}

export function buildReasons(viewerProfile: any, candidate: Pick<Candidate, 'profile'>): string[] {
  const reasons: string[] = [];
  const vHometown = viewerProfile?.stated?.hometown?.value;
  const cHometown = candidate.profile?.stated?.hometown?.value;
  if (vHometown && cHometown && vHometown === cHometown) {
    reasons.push(`你们都是${cHometown}人，聊起家乡会有共同语言`);
  }
  const vHobbies: string[] = viewerProfile?.stated?.hobbies?.value ?? [];
  const cHobbies: string[] = candidate.profile?.stated?.hobbies?.value ?? [];
  const common = vHobbies.filter((h) => cHobbies.includes(h));
  if (common.length > 0) {
    reasons.push(`你们都喜欢${common.join('、')}，第一次见面不愁没话聊`);
  }
  // 硬规则：含数字的理由整条不出（防收入/身高泄露）
  const clean = reasons.filter((r) => !containsDigit(r));
  if (clean.length === 0) {
    clean.push('你们的生活节奏和期待的连接方式很合拍');
  }
  assertNoDigits(clean);
  return clean;
}

export async function pickCandidate(viewerId: string, rng: () => number = Math.random): Promise<{
  candidate: Candidate;
  snapshot: any;
  reasons: string[];
  scoreBreakdown: ScoreBreakdown;
} | null> {
  const viewerTarget = await query<{ target: string }>(
    'SELECT target FROM connection_targets WHERE user_id = $1',
    [viewerId],
  );
  const target = viewerTarget[0]?.target ?? null;
  if (!target) return null;

  const viewerProfile = (
    await query<{ data: any }>('SELECT data FROM profiles WHERE user_id = $1', [viewerId])
  )[0]?.data;

  // 硬过滤：双方都已选目标且一致；30 天内不重推；排除自己
  const pool = await query<Candidate & { profile: any }>(
    `SELECT u.id, u.nickname, ct.target,
            COALESCE(p.data, '{"stated":{},"revealed":{}}') AS profile
     FROM users u
     JOIN connection_targets ct ON ct.user_id = u.id
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id <> $1
       AND ct.target = $2
       AND NOT EXISTS (SELECT 1 FROM matching_states ms WHERE ms.user_id = u.id AND ms.paused)
       AND NOT EXISTS (
         SELECT 1 FROM recommendations r
         WHERE r.created_at > now() - interval '30 days'
           AND ((r.user_id = $1 AND r.candidate_id = u.id)
             OR (r.user_id = u.id AND r.candidate_id = $1))
       )
       AND NOT EXISTS (
         SELECT 1 FROM recommendations r
         WHERE (r.user_id = u.id OR r.candidate_id = u.id)
           AND ${ACTIVE_RECOMMENDATION_SQL}
       )
     ORDER BY random() LIMIT ${RECALL_LIMIT}`,
    [viewerId, target],
  );
  if (pool.length === 0) return null;

  // dyad 打分：分别预测 A→B、B→A，调和平均合成 p_mutual
  const scored = pool.map((c) => {
    const ab = oneWayScore(viewerProfile, c.profile);
    const ba = oneWayScore(c.profile, viewerProfile);
    const pMutual = harmonicMean(ab.p, ba.p);
    const uncertainty = 1 - completeness(c.profile);
    return { candidate: c, ab, ba, pMutual, uncertainty };
  });

  // 选择：80% 取 p_mutual 最高；20% 探索不确定但值得试的
  const exploring = rng() < EXPLORE_RATE;
  let best = scored[0]!;
  if (exploring) {
    for (const s of scored) {
      const key = s.pMutual * (1 + s.uncertainty);
      const bestKey = best.pMutual * (1 + best.uncertainty);
      if (key > bestKey) best = s;
    }
  } else {
    for (const s of scored) {
      if (s.pMutual > best.pMutual) best = s;
    }
  }

  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const scoreBreakdown: ScoreBreakdown = {
    version: SCORE_VERSION,
    p_ab: r3(best.ab.p),
    p_ba: r3(best.ba.p),
    p_mutual: r3(best.pMutual),
    alignment_ab: r3(best.ab.alignment),
    chemistry_ab: r3(best.ab.chemistry),
    alignment_ba: r3(best.ba.alignment),
    chemistry_ba: r3(best.ba.chemistry),
    traits_ab: getTraits(viewerProfile).traits.map((t) => t.trait),
    traits_ba: getTraits(best.candidate.profile).traits.map((t) => t.trait),
    explored: exploring,
    candidate_pool: pool.length,
  };

  return {
    candidate: best.candidate,
    snapshot: sanitizeSnapshot(best.candidate.profile),
    reasons: buildReasons(viewerProfile, best.candidate),
    scoreBreakdown,
  };
}

/** 对用户可见的推荐状态：pass 只在内部标记，对外与「等待中」无法区分 */
export function publicStatus(status: string, expired = false): 'pending' | 'mutual' | 'expired' {
  if (expired || status === 'expired') return 'expired';
  return status === 'mutual' ? 'mutual' : 'pending';
}

export function weekKey(d = new Date()): string {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
