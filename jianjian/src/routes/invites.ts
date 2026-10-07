import type { FastifyInstance } from 'fastify';
import { newInviteCode, requireAuth } from '../auth.js';
import { query } from '../db/db.js';

// 搭桥邀请盲盒规则：
// - 每人每周最多 5 封；同一对象 30 天内只能邀请一次
// - 邀请人只能看到 sent/registered/experienced，看不到画像与选择
// - 任一方 pass：另一方与邀请人永远不知道

export async function inviteRoutes(app: FastifyInstance) {
  // 发起邀请
  app.post('/api/invites', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { inviteePhone, inviteeEmail, kind } = (req.body ?? {}) as {
      inviteePhone?: string;
      inviteeEmail?: string;
      kind?: 'bridge' | 'crush';
    };
    if (!inviteePhone && !inviteeEmail) {
      return reply.code(400).send({ error: '请提供被邀请人手机号或邮箱' });
    }
    const weekly = await query<{ c: string }>(
      `SELECT COUNT(*) c FROM invites WHERE inviter_id = $1 AND created_at > now() - interval '7 days'
       AND status <> 'withdrawn'`,
      [userId],
    );
    if (Number(weekly[0].c) >= 5) {
      return reply.code(429).send({ error: '每周最多邀请 5 位' });
    }
    const dup = await query<{ c: string }>(
      `SELECT COUNT(*) c FROM invites
       WHERE inviter_id = $1 AND created_at > now() - interval '30 days'
       AND (invitee_phone = $2 OR invitee_email = $3) AND status <> 'withdrawn'`,
      [userId, inviteePhone ?? null, inviteeEmail ?? null],
    );
    if (Number(dup[0].c) > 0) {
      return reply.code(429).send({ error: '同一对象 30 天内只能邀请一次' });
    }
    const code = newInviteCode();
    const rows = await query<{ id: string }>(
      `INSERT INTO invites (inviter_id, invitee_phone, invitee_email, code, kind)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, inviteePhone ?? null, inviteeEmail ?? null, code, kind ?? 'bridge'],
    );
    // TODO: 实际发送邀请短信/微信（当前仅生成 code，发送走 notify）
    return { id: rows[0].id, code };
  });

  // 我发出的邀请（盲盒：只暴露注册/体验状态）
  app.get('/api/invites', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    return query(
      `SELECT id, kind, status, created_at FROM invites
       WHERE inviter_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
  });

  // 我收到的邀请（不暴露 kind：被邀请人不能看出是朋友搭桥还是暗恋）
  app.get('/api/invites/inbox', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const me = await query<{ phone: string }>('SELECT phone FROM users WHERE id = $1', [userId]);
    return query(
      `SELECT id, code, status, created_at FROM invites
       WHERE claimed_by = $1 OR (claimed_by IS NULL AND invitee_phone = $2 AND status = 'sent')
       ORDER BY created_at DESC`,
      [userId, me[0]?.phone],
    );
  });

  // 领取邀请（注册时绑定）
  app.post('/api/invites/:code/claim', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { code } = req.params as { code: string };
    const rows = await query<{ id: string; status: string }>(
      `UPDATE invites SET claimed_by = $1, status = 'registered'
       WHERE code = $2 AND status = 'sent' RETURNING id, status`,
      [userId, code],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '邀请不存在或已失效' });
    return { ok: true };
  });

  // 撤回（仅限 sent 状态）
  app.post('/api/invites/:id/revoke', async (req, reply) => {
    const userId = await requireAuth(req, reply);
    if (!userId) return;
    const { id } = req.params as { id: string };
    const rows = await query(
      `UPDATE invites SET status = 'withdrawn'
       WHERE id = $1 AND inviter_id = $2 AND status = 'sent' RETURNING id`,
      [id, userId],
    );
    if (rows.length === 0) return reply.code(404).send({ error: '无法撤回' });
    return { ok: true };
  });
}
