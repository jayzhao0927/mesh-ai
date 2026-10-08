import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { query, withTransaction } from '../db/db.js';
import { buildReasons, publicStatus, sanitizeReasons, sanitizeSnapshot } from '../matching.js';
import { ACTIVE_RECOMMENDATION_SQL, isRecommendationExpired } from '../recommendation-lifecycle.js';
import { generateRecommendation } from '../recommendation-service.js';
import { settleMatchingLifecycle, resetResponseStreak } from '../matching-lifecycle.js';
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
  time_expired: boolean;
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
  // 当前有效推荐（需登录）
  app.get('/api/recommendations/current', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const rows = await query(
      `SELECT r.id, r.candidate_snapshot, r.reasons, r.link_token, r.status, r.created_at
       FROM recommendations r WHERE r.user_id = $1 AND ${ACTIVE_RECOMMENDATION_SQL}
       ORDER BY r.created_at DESC LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '暂时没有有效推荐' });
    const r = rows[0] as any;
    return {
      ...r,
      candidate_snapshot: sanitizeSnapshot(r.candidate_snapshot),
      reasons: sanitizeReasons(r.reasons),
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
         AND ${ACTIVE_RECOMMENDATION_SQL}
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
      `SELECT id, user_id, candidate_id, candidate_snapshot, reasons, link_token, status, created_at,
              created_at <= now() - interval '24 hours' AS time_expired
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
    if (isRecommendationExpired(r.status, r.time_expired)) {
      return reply.code(410).send({ error: '推荐已过期' });
    }
    return {
      id: r.id,
      role,
      candidate_snapshot: sanitizeSnapshot(card),
      reasons: sanitizeReasons(reasons),
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

  // 生成下一条推荐（内部/cron 调用；dev 下开放便于联调）
  app.post('/api/recommendations/generate', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const generated = await generateRecommendation(userId);
    if (!generated.ok) {
      if (generated.reason === 'no_candidate') return reply.code(404).send({ error: '暂无合适候选人' });
      return reply.code(409).send({ error: generated.reason === 'paused' ? '匹配已暂停，在对话中说“继续匹配”即可恢复' : '当前连接尚未结束' });
    }
    const link = shareLink('rec', generated.linkToken);
    await notifyRecommendation(userId, link);
    await notifyRecommendation(generated.candidateId, link);
    return { id: generated.id, link };
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
    const result = await withTransaction(async () => {
      await settleMatchingLifecycle();
      const reco = await query<{ user_id: string; candidate_id: string; status: string; time_expired: boolean }>(
        `SELECT user_id, candidate_id, status, created_at <= now() - interval '24 hours' AS time_expired
         FROM recommendations WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (reco.length === 0) return { code: 404, body: { error: '推荐不存在' } };
      const r = reco[0];
      const side = userId === r.user_id ? 'a' : userId === r.candidate_id ? 'b' : null;
      if (!side) return { code: 403, body: { error: '你不在这次推荐中' } };
      if (isRecommendationExpired(r.status, r.time_expired)) return { code: 410, body: { error: '推荐已过期' } };
      if (r.status === 'mutual') return choice === 'interested'
        ? { code: 200, body: { ok: true, mutual: true } }
        : { code: 409, body: { error: '当前连接已进入视频安排' } };

      await query(
        `INSERT INTO recommendation_intents (recommendation_id, user_id, side, choice)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (recommendation_id, user_id) DO UPDATE SET choice = $4`,
        [id, userId, side, choice],
      );
      await resetResponseStreak(userId);

      if (choice === 'pass') {
        // 任一方 pass：另一方与邀请人永远不知道（状态仅内部标记）
        await query(`UPDATE recommendations SET status = 'passed' WHERE id = $1`, [id]);
        return { code: 200, body: { ok: true, mutual: false } };
      }
      const intents = await query<{ side: string; choice: string }>(
        'SELECT side, choice FROM recommendation_intents WHERE recommendation_id = $1',
        [id],
      );
      const mutual =
        intents.length === 2 && intents.every((i) => i.choice === 'interested');
      if (mutual) {
        await query(`UPDATE recommendations SET status = 'mutual', mutual_at = COALESCE(mutual_at, now()) WHERE id = $1`, [id]);
      }
      return { code: 200, body: { ok: true, mutual } };
    });
    return reply.code(result.code).send(result.body);
  });
}
