import './env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auth, member, register, setupTestApp, sql, type TestUser } from './helpers.js';

const ctx = setupTestApp();

async function recommended(): Promise<{ a: TestUser; b: TestUser; id: string; token: string }> {
  const a = await member(ctx.app, '稳定恋爱', { hometown: '杭州' });
  const b = await member(ctx.app, '稳定恋爱', { hometown: '杭州' });
  const gen = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(a) });
  assert.equal(gen.statusCode, 200);
  return { a, b, id: gen.json().id, token: String(gen.json().link).split('/').pop()! };
}

function intent(user: TestUser, id: string, choice: 'interested' | 'pass') {
  return ctx.app.inject({ method: 'POST', url: `/api/recommendations/${id}/intent`, headers: auth(user), payload: { choice } });
}

describe('双向盲选', () => {
  it('双方 interested 才 mutual，mutual 后才能建视频房，房间号固定且第三人进不去', async () => {
    const { a, b, id } = await recommended();
    const early = await ctx.app.inject({ method: 'POST', url: '/api/video/rooms', headers: auth(a), payload: { recommendationId: id } });
    assert.equal(early.statusCode, 403);
    assert.equal((await intent(a, id, 'interested')).json().mutual, false);
    assert.equal((await intent(b, id, 'interested')).json().mutual, true);
    const room = await ctx.app.inject({ method: 'POST', url: '/api/video/rooms', headers: auth(a), payload: { recommendationId: id } });
    assert.equal(room.statusCode, 200);
    const again = await ctx.app.inject({ method: 'POST', url: '/api/video/rooms', headers: auth(b), payload: { recommendationId: id } });
    assert.equal(again.json().roomId, room.json().roomId);
    const stranger = await register(ctx.app);
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/v/${room.json().roomId}`, headers: auth(b) })).statusCode, 200);
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/v/${room.json().roomId}`, headers: auth(stranger) })).statusCode, 403);
    assert.equal((await intent(stranger, id, 'interested')).statusCode, 403);
  });

  for (const order of ['pass-first', 'pass-last'] as const) {
    it(`候选人 pass（${order}）：发起方的接口返回、当前推荐、分享页都看不出`, async () => {
      const { a, b, id, token } = await recommended();
      let aResult;
      if (order === 'pass-first') {
        await intent(b, id, 'pass');
        aResult = await intent(a, id, 'interested');
      } else {
        aResult = await intent(a, id, 'interested');
        await intent(b, id, 'pass');
      }
      assert.deepEqual(aResult.json(), { ok: true, mutual: false });
      const current = (await ctx.app.inject({ method: 'GET', url: '/api/recommendations/current', headers: auth(a) })).json();
      assert.equal(current.status, 'pending');
      const share = (await ctx.app.inject({ method: 'GET', url: `/s/rec/${token}` })).json();
      assert.equal(share.status, 'pending');
      const room = await ctx.app.inject({ method: 'POST', url: '/api/video/rooms', headers: auth(a), payload: { recommendationId: id } });
      assert.equal(room.statusCode, 403);
      assert.equal(room.body.includes('pass'), false);
    });
  }

  it('发起方 pass：候选人的接口返回同样看不出', async () => {
    const { a, b, id } = await recommended();
    await intent(a, id, 'pass');
    assert.deepEqual((await intent(b, id, 'interested')).json(), { ok: true, mutual: false });
  });
});

describe('被推荐人「待我表态」', () => {
  function get(user: TestUser | null, url: string) {
    return ctx.app.inject({ method: 'GET', url, headers: user ? auth(user) : {} });
  }

  it('生成推荐时双方都收到同一条分享链接', async () => {
    const { a, b, token } = await recommended();
    const logs = await sql<{ user_id: string; ref_id: string }>(
      `SELECT user_id, ref_id FROM notification_logs WHERE kind = 'recommendation'`,
    );
    for (const u of [a, b]) assert.ok(logs.some((l) => l.user_id === u.id && l.ref_id.endsWith(`/s/rec/${token}`)));
  });

  it('分享链接进入必须登录；第三人 403；双方各看到对方的卡片，看不到对方的选择', async () => {
    const a = await member(ctx.app, '稳定恋爱', { hometown: '杭州', occupation: '设计师', hobbies: ['徒步'] });
    const b = await member(ctx.app, '稳定恋爱', { hometown: '杭州', occupation: '医生', hobbies: ['徒步'] });
    const gen = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(a) });
    const id = gen.json().id as string;
    const token = String(gen.json().link).split('/').pop()!;
    const url = `/api/recommendations/by-token/${token}`;

    assert.equal((await get(null, url)).statusCode, 401);
    assert.equal((await get(await register(ctx.app), url)).statusCode, 403);

    const asB = (await get(b, url)).json();
    assert.equal(asB.role, 'candidate');
    assert.equal(asB.candidate_snapshot.stated.occupation.value, '设计师');
    assert.equal(asB.myChoice, null);
    assert.ok((asB.reasons as string[]).some((r) => r.includes('杭州')));

    await intent(a, id, 'interested');
    const asBAfter = (await get(b, url)).json();
    assert.equal(asBAfter.status, 'pending');
    assert.equal(asBAfter.myChoice, null);
    assert.equal(JSON.stringify(asBAfter).includes('interested'), false);

    const asA = (await get(a, url)).json();
    assert.equal(asA.role, 'viewer');
    assert.equal(asA.candidate_snapshot.stated.occupation.value, '医生');
    assert.equal(asA.myChoice, 'interested');

    await intent(b, id, 'interested');
    assert.equal((await get(b, url)).json().status, 'mutual');
    assert.equal((await get(b, '/api/recommendations/current')).statusCode, 404);
  });

  it('incoming 一次只给一条；发起方 pass 后照样出现；表态后消失', async () => {
    const { a, b, id, token } = await recommended();
    assert.equal((await get(a, '/api/recommendations/incoming')).statusCode, 404);
    await intent(a, id, 'pass');
    const inc = await get(b, '/api/recommendations/incoming');
    assert.equal(inc.statusCode, 200);
    assert.deepEqual(Object.keys(inc.json()).sort(), ['link', 'token']);
    assert.equal(inc.json().token, token);
    const card = (await get(b, `/api/recommendations/by-token/${token}`)).json();
    assert.equal(card.status, 'pending');
    assert.equal((await intent(b, id, 'interested')).json().mutual, false);
    assert.equal((await get(b, '/api/recommendations/incoming')).statusCode, 404);
  });

  it('被推荐人看到的发起方卡片同样不含数字', async () => {
    const a = await member(ctx.app, '稳定恋爱', { hometown: '杭州', occupation: '工程师3年', height: '180' });
    const b = await member(ctx.app, '稳定恋爱', { hometown: '杭州' });
    const gen = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(a) });
    const token = String(gen.json().link).split('/').pop()!;
    const card = (await get(b, `/api/recommendations/by-token/${token}`)).json();
    assert.deepEqual(card.candidate_snapshot, { stated: { hometown: { value: '杭州' } }, revealed: {} });
    assert.equal(/[0-9０-９]/.test(JSON.stringify([card.candidate_snapshot, card.reasons])), false);
  });
});
