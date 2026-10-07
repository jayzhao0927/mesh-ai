import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { query } from './db/db.js';

// Scaffold 鉴权：dev 模式签发 HMAC token；生产切 otp（手机验证码）后替换此处。
// Token 格式：base64url(userId).base64url(hmac)

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}

export function signToken(userId: string): string {
  const payload = b64url(userId);
  const sig = createHmac('sha256', config.authSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = createHmac('sha256', config.authSecret).update(payload).digest('base64url');
  if (sig !== expect) return null;
  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    reply.code(401).send({ error: '未登录' });
    return null;
  }
  return userId;
}

export async function getOrCreateUserByPhone(phone: string, nickname = '') {
  const rows = await query<{ id: string }>('SELECT id FROM users WHERE phone = $1', [phone]);
  if (rows.length > 0) return rows[0].id;
  const created = await query<{ id: string }>(
    'INSERT INTO users (phone, nickname) VALUES ($1, $2) RETURNING id',
    [phone, nickname || `用户${phone.slice(-4)}`],
  );
  const id = created[0].id;
  await query('INSERT INTO agent_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
  await query('INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
  return id;
}

export function newInviteCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
}
