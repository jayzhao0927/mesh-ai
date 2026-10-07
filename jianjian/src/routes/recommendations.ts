import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { query } from '../db/db.js';
import { buildReasons, pickCandidate, publicStatus, sanitizeSnapshot, weekKey } from '../matching.js';
import { notifyRecommendation } from '../notify.js';
import { shareLink } from './share.js';

// 推荐：一次一人；双向盲选；分享链接统一格式 /s/rec/{link_token}（短信/微信链接唯一参数，免登录打开）

type Choice = 'interested' | 'pass';

interface RecoRow {
  id: string;
  user_id: string;
  candidate_id: string;
  candidate_snapshot: unknown;
  reasons: string[];
  link_token: string;
  status: string;
  created_at: string;
}

/** 只返回自己的选择；对方的选择任何时候都不出接口 */
async function myChoice(recommendationId: string, userId: string): Promise<Choice | null> {
  const rows = await query<{ choice: Choice }>(
    'SELECT choice FROM recommendation_intents WHERE recommendation_id = $1 AND user_id = $2',
    [recommendationId, userId],
  );
  return rows[0]?.choice ?? null;
}

async function profileOf(userId: string): Promise<unknown> {
  const rows = await query<{ data: unknown }>('SELECT data FROM profiles WHERE user_id = $1', [userId]);
  return rows[0]?.data ?? { stated: {}, revealed: {} };
}

export async function recommendationRoutes(app: FastifyInstance) {
  // 本周推荐（需登录）
  app.get('/api/recommendations/current', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const rows = await query(
      `SELECT id, candidate_snapshot, reasons, link_token, status, created_at
       FROM recommendations WHERE user_id = $1 AND week = $2`,
      [userId, weekKey()],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '本周推荐尚未生成' });
    const r = rows[0] as any;
    return {
      ...r,
      status: publicStatus(r.status),
      myChoice: await myChoice(r.id, userId),
      link: shareLink('rec', r.link_token),
    };
  });

  // 待我表态：我作为被推荐人、还没表态的推荐，一次只给一条（按时间先后）。
  // 对方 pass 的推荐照常出现，否则「消失」本身就泄露了对方的选择。
  app.get('/api/recommendations/incoming', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const rows = await query<{ link_token: string }>(
      `SELECT r.link_token FROM recommendations r
       WHERE r.candidate_id = $1
         AND r.created_at > now() - interval '30 days'
         AND NOT EXISTS (
           SELECT 1 FROM recommendation_intents i
           WHERE i.recommendation_id = r.id AND i.user_id = $1
         )
       ORDER BY r.created_at ASC LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '暂时没有等你表态的推荐' });
    return { token: rows[0].link_token, link: shareLink('rec', rows[0].link_token) };
  });

  // 分享链接进入后的推荐卡（需登录）：按身份返回「对方」的卡片和自己的选择
  app.get('/api/recommendations/by-token/:token', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { token } = req.params as { token: string };
    const rows = await query<RecoRow>(
      `SELECT id, user_id, candidate_id, candidate_snapshot, reasons, link_token, status, created_at
       FROM recommendations WHERE link_token = $1`,
      [token],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '推荐链接无效' });
    const r = rows[0];
    let role: 'viewer' | 'candidate';
    let card: unknown;
    let reasons: string[];
    if (userId === r.user_id) {
      role = 'viewer';
      card = r.candidate_snapshot;
      reasons = r.reasons;
    } else if (userId === r.candidate_id) {
      role = 'candidate';
      const [viewerProfile, candidateProfile] = await Promise.all([profileOf(r.user_id), profileOf(r.candidate_id)]);
      card = sanitizeSnapshot(viewerProfile);
      reasons = buildReasons(candidateProfile, { profile: viewerProfile });
    } else {
      return reply.code(403).send({ error: '你不在这次推荐中' });
    }
    return {
      id: r.id,
      role,
      candidate_snapshot: card,
      reasons,
      status: publicStatus(r.status),
      myChoice: await myChoice(r.id, userId),
      created_at: r.created_at,
    };
  });

  // 旧链接兼容：/r/:token 永久重定向到统一格式
  app.get('/r/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    return reply.code(301).header('Location', `/s/rec/${token}`).send();
  });

  // 生成本周推荐（内部/cron 调用；dev 下开放便于联调）
  app.post('/api/recommendations/generate', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const week = weekKey();
    const existed = await query('SELECT id FROM recommendations WHERE user_id = $1 AND week = $2', [
      userId,
      week,
    ]);
    if (existed.length > 0) return reply.code(409).send({ error: '本周已生成推荐' });
    const picked = await pickCandidate(userId);
    if (!picked) return reply.code(404).send({ error: '暂无合适候选人' });
    const rows = await query<{ id: string; link_token: string }>(
      `INSERT INTO recommendations (user_id, week, candidate_id, candidate_snapshot, reasons, score_breakdown)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id, link_token`,
      [userId, week, picked.candidate.id, JSON.stringify(picked.snapshot), JSON.stringify(picked.reasons), JSON.stringify(picked.scoreBreakdown)],
    );
    const link = shareLink('rec', rows[0].link_token);
    await notifyRecommendation(userId, link);
    await notifyRecommendation(picked.candidate.id, link);
    return { id: rows[0].id, link };
  });

  // 表达意愿：interested / pass（盲选，对方不可见）
  app.post('/api/recommendations/:id/intent', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const { choice } = (req.body ?? {}) as { choice?: 'interested' | 'pass' };
    if (!['interested', 'pass'].includes(choice ?? '')) {
      return reply.code(400).send({ error: 'choice 只能是 interested 或 pass' });
    }
    const reco = await query<{ user_id: string; candidate_id: string; status: string }>(
      'SELECT user_id, candidate_id, status FROM recommendations WHERE id = $1',
      [id],
    );
    if (reco.length === 0) return reply.code(404).send({ error: '推荐不存在' });
    const r = reco[0];
    const side = userId === r.user_id ? 'a' : userId === r.candidate_id ? 'b' : null;
    if (!side) return reply.code(403).send({ error: '你不在这次推荐中' });

    await query(
      `INSERT INTO recommendation_intents (recommendation_id, user_id, side, choice)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (recommendation_id, user_id) DO UPDATE SET choice = $4`,
      [id, userId, side, choice],
    );

    if (choice === 'pass') {
      // 任一方 pass：另一方与邀请人永远不知道（状态仅内部标记）
      await query(`UPDATE recommendations SET status = 'passed' WHERE id = $1`, [id]);
      return { ok: true, mutual: false };
    }
    const intents = await query<{ side: string; choice: string }>(
      'SELECT side, choice FROM recommendation_intents WHERE recommendation_id = $1',
      [id],
    );
    const mutual =
      intents.length === 2 && intents.every((i) => i.choice === 'interested');
    if (mutual) {
      await query(`UPDATE recommendations SET status = 'mutual' WHERE id = $1`, [id]);
    }
    return { ok: true, mutual };
  });
}
