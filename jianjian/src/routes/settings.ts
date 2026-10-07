import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { query } from '../db/db.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const rows = await query<{ agent_name: string }>(
      'SELECT agent_name FROM agent_settings WHERE user_id = $1',
      [userId],
    );
    return { agentName: rows[0]?.agent_name ?? 'Jc' };
  });

  app.put('/api/settings', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { agentName } = (req.body ?? {}) as { agentName?: string };
    if (!agentName || agentName.length > 20) {
      return reply.code(400).send({ error: 'Agent 名不能为空且不超过 20 字' });
    }
    await query(
      `INSERT INTO agent_settings (user_id, agent_name, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET agent_name = $2, updated_at = now()`,
      [userId, agentName],
    );
    return { agentName };
  });
}
