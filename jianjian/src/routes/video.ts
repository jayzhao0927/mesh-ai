import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { query, withTransaction } from '../db/db.js';
import { settleMatchingLifecycle } from '../matching-lifecycle.js';
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
    const result = await withTransaction(async () => {
      await settleMatchingLifecycle();
      const reco = await query<{ user_id: string; candidate_id: string; status: string; mutual_at: Date }>(
        'SELECT user_id, candidate_id, status, mutual_at FROM recommendations WHERE id = $1 FOR UPDATE',
        [recommendationId],
      );
      if (reco.length === 0) return { code: 404, body: { error: '推荐不存在' } };
      const r = reco[0];
      if (userId !== r.user_id && userId !== r.candidate_id) {
        return { code: 403, body: { error: '你不在这次推荐中' } };
      }
      if (r.status === 'expired') return { code: 410, body: { error: '当前连接已结束' } };
      if (r.status !== 'mutual') return { code: 403, body: { error: '需双方都感兴趣后才能排期' } };
      if (scheduledAt !== undefined) {
        if (typeof scheduledAt !== 'string') return { code: 400, body: { error: '预约时间无效' } };
        const date = new Date(scheduledAt);
        const [{ valid }] = await query<{ valid: boolean }>(
          `SELECT $1::timestamptz > now() AND $1::timestamptz < $2::timestamptz + interval '48 hours' AS valid`,
          [Number.isFinite(date.getTime()) ? date : null, r.mutual_at]);
        if (!valid) return { code: 400, body: { error: '请选择视频截止时间前的有效预约时间' } };
      }
      const existed = await query<{ room_id: string; completed_at: Date | null }>(
        'SELECT room_id, completed_at FROM video_rooms WHERE recommendation_id = $1',
        [recommendationId],
      );
      if (existed[0]?.completed_at) return { code: 409, body: { error: '视频已完成，等待复盘' } };
      const roomId = existed[0]?.room_id ?? createRoomId();
      if (!existed[0]) {
        await query(
          `INSERT INTO video_rooms (recommendation_id, room_id, scheduled_at)
           VALUES ($1, $2, $3::timestamptz)`,
          [recommendationId, roomId, scheduledAt ?? null],
        );
      } else if (scheduledAt !== undefined) {
        await query('UPDATE video_rooms SET scheduled_at = $2::timestamptz WHERE recommendation_id = $1', [recommendationId, scheduledAt]);
      }
      const link = roomLink(roomId);
      return { code: 200, body: { roomId, link, userSig: buildUserSig(userId) }, participants: [r.user_id, r.candidate_id] };
    });
    // 通知双方（微信主 + 短信兜底）
    if (result.participants && 'link' in result.body) {
      for (const participant of result.participants) await notifyVideo(participant, result.body.link!);
    }
    return reply.code(result.code).send(result.body);
  });

  // 进房信息：凭 room_id（链接直达）
  app.get('/v/:roomId', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { roomId } = req.params as { roomId: string };
    const rows = await query(
      `SELECT vr.room_id, vr.scheduled_at, vr.status, r.user_id, r.candidate_id, r.status AS recommendation_status
       FROM video_rooms vr JOIN recommendations r ON r.id = vr.recommendation_id
       WHERE vr.room_id = $1`,
      [roomId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '房间不存在' });
    const room = rows[0] as any;
    if (userId !== room.user_id && userId !== room.candidate_id) {
      return reply.code(403).send({ error: '你不在这个房间中' });
    }
    if (room.recommendation_status !== 'mutual' || room.status === 'cancelled' || room.status === 'done') {
      return reply.code(410).send({ error: '当前连接已结束' });
    }
    return { roomId: room.room_id, scheduledAt: room.scheduled_at, userSig: buildUserSig(userId) };
  });
}
