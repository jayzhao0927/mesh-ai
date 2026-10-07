import './env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auth, member, setupTestApp } from './helpers.js';

const ctx = setupTestApp();

describe('画像', () => {
  it('只开放两个连接目标', async () => {
    const u = await member(ctx.app, '稳定恋爱');
    for (const target of ['交朋友', '八字合婚', '随便聊聊']) {
      const res = await ctx.app.inject({ method: 'PUT', url: '/api/profile', headers: auth(u), payload: { target } });
      assert.equal(res.statusCode, 400);
    }
    const ok = await ctx.app.inject({ method: 'PUT', url: '/api/profile', headers: auth(u), payload: { target: '奔着结婚认真谈' } });
    assert.equal(ok.statusCode, 200);
  });

  it('删除单条画像只删该键，特殊字符的 key 不会被拼进 SQL', async () => {
    const u = await member(ctx.app, '稳定恋爱', { hometown: '杭州', hobbies: ['徒步'] });
    const evil = encodeURIComponent("x}', updated_at = now() WHERE true; --");
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/profile/stated/${evil}`, headers: auth(u) });
    assert.equal(res.statusCode, 200);
    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/profile/stated/hometown', headers: auth(u) });
    assert.equal(del.statusCode, 200);
    const profile = (await ctx.app.inject({ method: 'GET', url: '/api/profile', headers: auth(u) })).json();
    assert.deepEqual(Object.keys(profile.data.stated), ['hobbies']);
  });
});
