import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { query } from '../db/db.js';
import { publicStatus, sanitizeReasons, sanitizeSnapshot } from '../matching.js';
import { isRecommendationExpired } from '../recommendation-lifecycle.js';

// 统一分享链接（原型端与后端共用同一格式）：
//   {PUBLIC_BASE_URL}/s/{type}/{token}
// type: rec（推荐）| video（视频房间）| agent（Agent 分享卡）
// 落地页一律免登录打开——短信/微信里的链接、外链浏览器窗口点开即达，
// 不需要 App 会话。需要身份的操作（表达意愿、进房拿 userSig）仍走登录接口，
// 短信真实发送与手机号验证码登录上线前保持 stub（见通知日志 status='stubbed'）。

export type ShareType = 'rec' | 'video' | 'agent';

export function shareLink(type: ShareType, token: string): string {
  return `${config.publicBaseUrl}/s/${type}/${token}`;
}

export async function shareRoutes(app: FastifyInstance) {
  // 创建 Agent 分享卡（需登录）：返回可对外分享的链接
  app.post('/api/agent/share', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const token = randomBytes(18).toString('hex');
    await query('INSERT INTO agent_shares (token, user_id) VALUES ($1, $2)', [token, userId]);
    return { token, link: shareLink('agent', token) };
  });

  // 统一落地页：凭链接直达，无需登录
  app.get('/s/:type/:token', async (req, reply) => {
    const { type, token } = req.params as { type: string; token: string };

    if (type === 'rec') {
      const rows = await query(
        `SELECT id, candidate_snapshot, reasons, status, created_at,
                created_at <= now() - interval '24 hours' AS time_expired
         FROM recommendations WHERE link_token = $1`,
        [token],
      );
      if (rows.length === 0) return reply.code(404).send({ error: '推荐链接无效' });
      const { time_expired, ...rec } = rows[0] as any;
      return {
        kind: 'rec', ...rec,
        candidate_snapshot: sanitizeSnapshot(rec.candidate_snapshot),
        reasons: sanitizeReasons(rec.reasons),
        status: publicStatus(rec.status, isRecommendationExpired(rec.status, time_expired)),
      };
    }

    if (type === 'video') {
      const rows = await query(
        `SELECT vr.room_id, vr.scheduled_at, vr.status,
                u1.nickname AS user_nickname, u2.nickname AS candidate_nickname
         FROM video_rooms vr
         JOIN recommendations r ON r.id = vr.recommendation_id
         JOIN users u1 ON u1.id = r.user_id
         JOIN users u2 ON u2.id = r.candidate_id
         WHERE vr.room_id = $1`,
        [token],
      );
      if (rows.length === 0) return reply.code(404).send({ error: '房间链接无效' });
      const room = rows[0] as any;
      return {
        kind: 'video',
        roomId: room.room_id,
        scheduledAt: room.scheduled_at,
        status: room.status,
        // 双方已 mutual，昵称对彼此可见；进房拿 userSig 仍需登录
        nicknames: [room.user_nickname, room.candidate_nickname],
        joinRequiresAuth: true,
      };
    }

    if (type === 'agent') {
      const rows = await query(
        `SELECT COALESCE(a.agent_name, '见见') AS agent_name, u.nickname AS owner_nickname
         FROM agent_shares s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN agent_settings a ON a.user_id = s.user_id
         WHERE s.token = $1`,
        [token],
      );
      if (rows.length === 0) return reply.code(404).send({ error: '分享链接无效' });
      const r = rows[0] as any;
      return { kind: 'agent', agentName: r.agent_name, ownerNickname: r.owner_nickname };
    }

    return reply.code(404).send({ error: '链接类型无效' });
  });
}
