import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { query } from '../db/db.js';
import { notifyVideo } from '../notify.js';
import { buildUserSig, createRoomId, roomLink } from '../video.js';

// 视频房间：双方 mutual 后排期，生成持久 room_id；链接可分享直达

export async function videoRoutes(app: FastifyInstance) {
  // 创建/获取房间（需 mutual）
  app.post('/api/video/rooms', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { recommendationId, scheduledAt } = (req.body ?? {}) as {
      recommendationId?: string;
      scheduledAt?: string;
    };
    const reco = await query<{ user_id: string; candidate_id: string; status: string }>(
      'SELECT user_id, candidate_id, status FROM recommendations WHERE id = $1',
      [recommendationId],
    );
    if (reco.length === 0) return reply.code(404).send({ error: '推荐不存在' });
    const r = reco[0];
    if (r.status !== 'mutual') return reply.code(403).send({ error: '需双方都感兴趣后才能排期' });
    if (userId !== r.user_id && userId !== r.candidate_id) {
      return reply.code(403).send({ error: '你不在这次推荐中' });
    }
    const existed = await query<{ room_id: string }>(
      'SELECT room_id FROM video_rooms WHERE recommendation_id = $1',
      [recommendationId],
    );
    const roomId = existed[0]?.room_id ?? createRoomId();
    if (!existed[0]) {
      await query(
        `INSERT INTO video_rooms (recommendation_id, room_id, scheduled_at)
         VALUES ($1, $2, $3::timestamptz)`,
        [recommendationId, roomId, scheduledAt ?? null],
      );
    }
    const link = roomLink(roomId);
    // 通知双方（微信主 + 短信兜底）
    await notifyVideo(r.user_id, link);
    await notifyVideo(r.candidate_id, link);
    return { roomId, link, userSig: buildUserSig(userId) };
  });

  // 进房信息：凭 room_id（链接直达）
  app.get('/v/:roomId', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { roomId } = req.params as { roomId: string };
    const rows = await query(
      `SELECT vr.room_id, vr.scheduled_at, vr.status, r.user_id, r.candidate_id
       FROM video_rooms vr JOIN recommendations r ON r.id = vr.recommendation_id
       WHERE vr.room_id = $1`,
      [roomId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '房间不存在' });
    const room = rows[0] as any;
    if (userId !== room.user_id && userId !== room.candidate_id) {
      return reply.code(403).send({ error: '你不在这个房间中' });
    }
    return { roomId: room.room_id, scheduledAt: room.scheduled_at, userSig: buildUserSig(userId) };
  });
}
