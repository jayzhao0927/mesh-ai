import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth.js';
import { answer, getState, OnboardingError } from '../onboarding.js';

export async function onboardingRoutes(app: FastifyInstance) {
  // 对话建档：当前该问哪一题 + 已聊过的内容
  app.get('/api/onboarding', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    return getState(userId);
  });

  // 回答当前这一题：{ key, value } 或 { key, skip: true }
  app.post('/api/onboarding/answer', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { key, value, skip } = (req.body ?? {}) as { key?: string; value?: unknown; skip?: boolean };
    if (!key) return reply.code(400).send({ error: '缺少 key' });
    try {
      return await answer(userId, key, { value, skip: skip === true });
    } catch (err) {
      if (err instanceof OnboardingError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
