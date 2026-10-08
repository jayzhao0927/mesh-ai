import './env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { getAgentName } from '../src/agent-name.js';
import { auth, register, setupTestApp, sql } from './helpers.js';

const ctx = setupTestApp();

describe('Agent 默认名与自定义名', () => {
  it('新用户的默认名是见见，设置接口与分享卡一致', async () => {
    const user = await register(ctx.app);
    const settings = await ctx.app.inject({ method: 'GET', url: '/api/settings', headers: auth(user) });
    assert.equal(settings.json().agentName, '见见');
    const shared = await ctx.app.inject({ method: 'POST', url: '/api/agent/share', headers: auth(user) });
    const token = String(shared.json().link).split('/').pop();
    const landing = await ctx.app.inject({ method: 'GET', url: `/s/agent/${token}` });
    assert.equal(landing.json().agentName, '见见');
  });

  it('重跑迁移保留已有自定义名，包括用户自己选的 Jc', async () => {
    const user = await register(ctx.app);
    await ctx.app.inject({ method: 'PUT', url: '/api/settings', headers: auth(user), payload: { agentName: 'Jc' } });
    await sql(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
    assert.equal(await getAgentName(user.id), 'Jc');
    const next = await register(ctx.app);
    assert.equal(await getAgentName(next.id), '见见');
  });
});
