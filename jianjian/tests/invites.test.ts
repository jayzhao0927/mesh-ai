import './env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auth, register, setupTestApp, sql } from './helpers.js';

const ctx = setupTestApp();

async function invite(token: Record<string, string>, phone: string, kind?: 'bridge' | 'crush') {
  return ctx.app.inject({ method: 'POST', url: '/api/invites', headers: token, payload: { inviteePhone: phone, kind } });
}

describe('搭桥邀请', () => {
  it('每周最多 5 封，第 6 封 429', async () => {
    const a = await register(ctx.app);
    for (let i = 0; i < 5; i++) {
      assert.equal((await invite(auth(a), `1370000000${i}`)).statusCode, 200);
    }
    const sixth = await invite(auth(a), '13700000009');
    assert.equal(sixth.statusCode, 429);
    assert.match(sixth.json().error, /每周最多邀请/);
  });

  it('7 天前的邀请不占本周名额', async () => {
    const a = await register(ctx.app);
    for (let i = 0; i < 5; i++) await invite(auth(a), `1370000000${i}`);
    await sql(`UPDATE invites SET created_at = now() - interval '8 days' WHERE inviter_id = $1`, [a.id]);
    assert.equal((await invite(auth(a), '13700000009')).statusCode, 200);
  });

  it('同一对象 30 天内只能邀请一次，超过 30 天可以再邀', async () => {
    const a = await register(ctx.app);
    assert.equal((await invite(auth(a), '13700000001')).statusCode, 200);
    const dup = await invite(auth(a), '13700000001', 'crush');
    assert.equal(dup.statusCode, 429);
    assert.match(dup.json().error, /30 天/);
    await sql(`UPDATE invites SET created_at = now() - interval '31 days' WHERE inviter_id = $1`, [a.id]);
    assert.equal((await invite(auth(a), '13700000001')).statusCode, 200);
  });

  it('邀请人只能看到注册/体验状态，看不到对方画像与选择', async () => {
    const a = await register(ctx.app);
    const created = (await invite(auth(a), '13700000001', 'crush')).json();
    const invitee = await ctx.app.inject({ method: 'POST', url: '/api/auth/dev-token', payload: { phone: '13700000001' } });
    const inviteeAuth = { authorization: `Bearer ${invitee.json().token}` };
    assert.equal(
      (await ctx.app.inject({ method: 'POST', url: `/api/invites/${created.code}/claim`, headers: inviteeAuth })).statusCode,
      200,
    );
    const mine = (await ctx.app.inject({ method: 'GET', url: '/api/invites', headers: auth(a) })).json();
    assert.equal(mine.length, 1);
    assert.deepEqual(Object.keys(mine[0]).sort(), ['created_at', 'id', 'kind', 'status']);
    assert.equal(mine[0].status, 'registered');
  });

  it('被邀请人收件箱看不出邀请类型（暗恋意图保密），也看不到邀请人', async () => {
    const a = await register(ctx.app);
    await invite(auth(a), '13700000001', 'crush');
    const invitee = await ctx.app.inject({ method: 'POST', url: '/api/auth/dev-token', payload: { phone: '13700000001' } });
    const inbox = (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/invites/inbox',
        headers: { authorization: `Bearer ${invitee.json().token}` },
      })
    ).json();
    assert.equal(inbox.length, 1);
    assert.deepEqual(Object.keys(inbox[0]).sort(), ['code', 'created_at', 'id', 'status']);
    assert.equal(JSON.stringify(inbox).includes(a.id), false);
  });
});
