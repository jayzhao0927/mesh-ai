import type { FastifyInstance } from 'fastify';
import { getOrCreateUserByPhone, requireAuth, signToken } from '../auth.js';
import { config } from '../config.js';

export async function authRoutes(app: FastifyInstance) {
  // dev 模式：手机号直接换 token（生产切 otp 验证码后，此接口下线）
  app.post('/api/auth/dev-token', async (req, reply) => {
    if (config.authMode !== 'dev') return reply.code(403).send({ error: 'dev 接口已关闭' });
    const { phone, nickname } = (req.body ?? {}) as { phone?: string; nickname?: string };
    if (!phone || !/^1\d{10}$/.test(phone)) {
      return reply.code(400).send({ error: '手机号格式不正确' });
    }
    const userId = await getOrCreateUserByPhone(phone, nickname);
    return { token: signToken(userId), userId };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    return { userId };
  });
}
