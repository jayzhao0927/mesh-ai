import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { query } from '../db/db.js';

// Living Profile：stated / revealed 双轨，带来源、置信度、更新时间；可看可改可删

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/profile', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const rows = await query<{ data: any }>('SELECT data FROM profiles WHERE user_id = $1', [userId]);
    const target = await query<{ target: string }>(
      'SELECT target FROM connection_targets WHERE user_id = $1',
      [userId],
    );
    return { data: rows[0]?.data ?? { stated: {}, revealed: {} }, target: target[0]?.target ?? null };
  });

  // 整包更新（客户端已做冲突确认）；单条改/删走下面的 key 接口
  app.put('/api/profile', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { data, target } = (req.body ?? {}) as { data?: any; target?: string };
    if (data) {
      await query(
        `INSERT INTO profiles (user_id, data, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (user_id) DO UPDATE SET data = $2::jsonb, updated_at = now()`,
        [userId, JSON.stringify(data)],
      );
    }
    if (target) {
      if (!['稳定恋爱', '奔着结婚认真谈'].includes(target)) {
        return reply.code(400).send({ error: '目标不在当前开放范围' });
      }
      await query(
        `INSERT INTO connection_targets (user_id, target, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET target = $2, updated_at = now()`,
        [userId, target],
      );
    }
    return { ok: true };
  });

  // 单条删除（stated/revealed 任一轨）
  app.delete('/api/profile/:track/:key', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { track, key } = req.params as { track: string; key: string };
    if (!['stated', 'revealed'].includes(track)) {
      return reply.code(400).send({ error: 'track 只能是 stated 或 revealed' });
    }
    await query('UPDATE profiles SET data = data #- $2::text[], updated_at = now() WHERE user_id = $1', [
      userId,
      [track, key],
    ]);
    return { ok: true };
  });
}
