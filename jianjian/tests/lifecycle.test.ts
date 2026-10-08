import './env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickCandidate } from '../src/matching.js';
import { query, withTransaction } from '../src/db/db.js';
import { auth, member, register, setupTestApp, sql, type TestUser } from './helpers.js';

const ctx = setupTestApp();

async function recommended() {
  const a = await member(ctx.app, '稳定恋爱', { hometown: '杭州' });
  const b = await member(ctx.app, '稳定恋爱', { hometown: '杭州' });
  const res = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(a) });
  assert.equal(res.statusCode, 200);
  return { a, b, id: res.json().id as string, token: String(res.json().link).split('/').pop()! };
}

function intent(user: TestUser, id: string, choice: 'interested' | 'pass') {
  return ctx.app.inject({ method: 'POST', url: `/api/recommendations/${id}/intent`, headers: auth(user), payload: { choice } });
}

describe('推荐有效期与推荐位', () => {
  it('跨周但未满一天的推荐仍然是当前推荐', async () => {
    const { a, id } = await recommended();
    await sql("UPDATE recommendations SET week = 'previous-week' WHERE id = $1", [id]);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/recommendations/current', headers: auth(a) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().id, id);
  });

  for (const otherChoice of ['unread', 'pass', 'interested'] as const) {
    it(`过期推荐不再可表态，过期视图不泄露对方状态：${otherChoice}`, async () => {
      const { a, b, id, token } = await recommended();
      if (otherChoice !== 'unread') await intent(b, id, otherChoice);
      await sql("UPDATE recommendations SET created_at = now() - interval '25 hours' WHERE id = $1", [id]);
      const current = await ctx.app.inject({ method: 'GET', url: '/api/recommendations/current', headers: auth(a) });
      assert.equal(current.statusCode, 404);
      const incoming = await ctx.app.inject({ method: 'GET', url: '/api/recommendations/incoming', headers: auth(b) });
      assert.equal(incoming.statusCode, 404);
      const share = await ctx.app.inject({ method: 'GET', url: `/s/rec/${token}` });
      assert.equal(share.json().status, 'expired');
      const card = await ctx.app.inject({ method: 'GET', url: `/api/recommendations/by-token/${token}`, headers: auth(a) });
      assert.equal(card.statusCode, 410);
      const attempt = await intent(a, id, 'interested');
      assert.equal(attempt.statusCode, 410);
      assert.equal((await sql('SELECT * FROM recommendation_intents WHERE recommendation_id = $1 AND user_id = $2', [id, a.id])).length, 0);
      assert.deepEqual(card.json(), { error: '推荐已过期' });
    });
  }

  it('对方早早 Pass 与未读的等待视图完全相同，推荐位继续占用', async () => {
    const { a, b, id, token } = await recommended();
    await intent(a, id, 'interested');
    const urls = ['/api/recommendations/current', `/api/recommendations/by-token/${token}`, `/s/rec/${token}`];
    const before = await Promise.all(urls.map(url => ctx.app.inject({ method: 'GET', url, headers: auth(a) })));
    await intent(b, id, 'pass');
    for (let index = 0; index < urls.length; index++) {
      const after = await ctx.app.inject({ method: 'GET', url: urls[index], headers: auth(a) });
      assert.equal(after.statusCode, before[index].statusCode);
      assert.deepEqual(after.json(), before[index].json());
    }
    await sql("UPDATE recommendations SET week = 'previous-week' WHERE id = $1", [id]);
    await member(ctx.app, '稳定恋爱');
    const again = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(a) });
    assert.equal(again.statusCode, 409);
  });

  it('被推荐人已经占用推荐位，不再获得另一条推荐或进入另一人的候选池', async () => {
    const { b } = await recommended();
    const c = await member(ctx.app, '稳定恋爱');
    const again = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(b) });
    assert.equal(again.statusCode, 409);
    assert.equal(await pickCandidate(c.id), null);
  });

  it('mutual 超过一天后仍为视频排期保留推荐位，双方不再进入其他人的候选池', async () => {
    const { a, b, id } = await recommended();
    await intent(a, id, 'interested');
    await intent(b, id, 'interested');
    await sql("UPDATE recommendations SET created_at = now() - interval '25 hours', week = 'previous-week' WHERE id = $1", [id]);
    const c = await member(ctx.app, '稳定恋爱');
    const current = await ctx.app.inject({ method: 'GET', url: '/api/recommendations/current', headers: auth(a) });
    assert.equal(current.statusCode, 200);
    assert.equal(current.json().status, 'mutual');
    assert.equal(await pickCandidate(c.id), null);
    for (const user of [a, b]) {
      const gen = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(user) });
      assert.equal(gen.statusCode, 409);
    }
  });

  it('并发生成不导致重复推荐或两位用户同时占用同一候选人', async () => {
    const a = await member(ctx.app, '稳定恋爱');
    await member(ctx.app, '稳定恋爱');
    await member(ctx.app, '稳定恋爱');
    const results = await Promise.all(Array.from({ length: 4 }, () => ctx.app.inject({
      method: 'POST', url: '/api/recommendations/generate', headers: auth(a),
    })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409, 409, 409]);
    assert.equal((await sql('SELECT id FROM recommendations WHERE user_id = $1', [a.id])).length, 1);
  });

  it('不同用户并发生成后，每个参与人最多出现在一条有效推荐里', async () => {
    const a = await member(ctx.app, '稳定恋爱');
    const b = await member(ctx.app, '稳定恋爱');
    await member(ctx.app, '稳定恋爱');
    await member(ctx.app, '稳定恋爱');
    const results = await Promise.all([a, b].map(user => ctx.app.inject({
      method: 'POST', url: '/api/recommendations/generate', headers: auth(user),
    })));
    for (const res of results) assert.ok([200, 404, 409].includes(res.statusCode), res.body);
    const duplicates = await sql(`
      SELECT participant FROM (
        SELECT user_id AS participant FROM recommendations
        UNION ALL SELECT candidate_id AS participant FROM recommendations
      ) participants GROUP BY participant HAVING COUNT(*) > 1
    `);
    assert.equal(duplicates.length, 0);
  });

  it('反向推荐同样遵守不重推窗口', async () => {
    const a = await member(ctx.app, '稳定恋爱');
    const b = await member(ctx.app, '稳定恋爱');
    await sql(`INSERT INTO recommendations (user_id, week, candidate_id, candidate_snapshot, reasons, created_at)
      VALUES ($1, 'previous', $2, '{}'::jsonb, '[]'::jsonb, now() - interval '29 days')`, [b.id, a.id]);
    assert.equal(await pickCandidate(a.id), null);
  });

  it('历史快照与理由也重新脱敏，不泄露数字或私有画像', async () => {
    const { a, id, token } = await recommended();
    await sql('UPDATE recommendations SET candidate_snapshot = $2::jsonb, reasons = $3::jsonb WHERE id = $1', [
      id,
      JSON.stringify({ stated: { hometown: { value: '杭州' }, height: { value: '180' } }, revealed: { private: { value: '秘密' } } }),
      JSON.stringify(['身高１８０', '收入٣٠万', '你们都喜欢阅读']),
    ]);
    for (const url of ['/api/recommendations/current', `/api/recommendations/by-token/${token}`, `/s/rec/${token}`]) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: auth(a) });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json().reasons, ['你们都喜欢阅读']);
      assert.deepEqual(res.json().candidate_snapshot, { stated: { hometown: { value: '杭州' } }, revealed: {} });
    }
  });

  it('事务失败回滚所有领域查询写入', async () => {
    const a = await register(ctx.app);
    await assert.rejects(withTransaction(async () => {
      await query("INSERT INTO notification_logs (user_id, channel, kind) VALUES ($1, 'sms', 'rollback-test')", [a.id]);
      throw new Error('rollback');
    }), /rollback/);
    assert.equal((await sql("SELECT id FROM notification_logs WHERE kind = 'rollback-test'")).length, 0);
  });
});

describe('邀请限额不可通过撤回绕过', () => {
  it('撤回后的邀请仍计入发送上限', async () => {
    const a = await register(ctx.app);
    for (let i = 0; i < 5; i++) {
      const created = await ctx.app.inject({ method: 'POST', url: '/api/invites', headers: auth(a), payload: { inviteePhone: `1360000000${i}` } });
      assert.equal(created.statusCode, 200);
      assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/invites/${created.json().id}/revoke`, headers: auth(a) })).statusCode, 200);
    }
    const sixth = await ctx.app.inject({ method: 'POST', url: '/api/invites', headers: auth(a), payload: { inviteePhone: '13600000009' } });
    assert.equal(sixth.statusCode, 429);
  });

  it('撤回后同一对象仍须等待去重窗口', async () => {
    const a = await register(ctx.app);
    const first = await ctx.app.inject({ method: 'POST', url: '/api/invites', headers: auth(a), payload: { inviteePhone: '13600000001' } });
    await ctx.app.inject({ method: 'POST', url: `/api/invites/${first.json().id}/revoke`, headers: auth(a) });
    const duplicate = await ctx.app.inject({ method: 'POST', url: '/api/invites', headers: auth(a), payload: { inviteePhone: '13600000001' } });
    assert.equal(duplicate.statusCode, 429);
  });

  it('并发发送同一对象只成功一次', async () => {
    const a = await register(ctx.app);
    const results = await Promise.all(Array.from({ length: 3 }, () => ctx.app.inject({
      method: 'POST', url: '/api/invites', headers: auth(a), payload: { inviteePhone: '13600000001' },
    })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 429, 429]);
  });
});
