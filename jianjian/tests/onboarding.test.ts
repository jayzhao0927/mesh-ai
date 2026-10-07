import './env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickCandidate } from '../src/matching.js';
import { STEPS } from '../src/onboarding.js';
import { auth, register, setupTestApp, sql, type TestUser } from './helpers.js';

const ctx = setupTestApp();

interface State {
  done: boolean;
  step: { key: string; options: string[]; skippable: boolean; multi?: boolean } | null;
  transcript: { question: string; answer: string | null }[];
  answered: number;
  total: number;
}

async function state(u: TestUser): Promise<State> {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/onboarding', headers: auth(u) });
  assert.equal(res.statusCode, 200);
  return res.json<State>();
}

function send(u: TestUser, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/onboarding/answer', headers: auth(u), payload });
}

/** 按顺序把整套对话走完：answers 里有的就答，没有的选第一个选项 */
async function finish(u: TestUser, answers: Record<string, unknown>): Promise<State> {
  let s = await state(u);
  for (let i = 0; i < 30 && !s.done; i++) {
    const step = s.step!;
    const value = answers[step.key] ?? (step.multi ? [step.options[0]] : step.options[0] ?? '杭州');
    const res = await send(u, value === 'SKIP' ? { key: step.key, skip: true } : { key: step.key, value });
    assert.equal(res.statusCode, 200, res.body);
    s = res.json<State>();
  }
  return s;
}

describe('对话建档', () => {
  it('需要登录', async () => {
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/onboarding' })).statusCode, 401);
  });

  it('第一题是连接目标，只有两个选项且不能跳过；非法目标拒绝', async () => {
    const u = await register(ctx.app);
    const s = await state(u);
    assert.equal(s.done, false);
    assert.equal(s.step?.key, 'target');
    assert.deepEqual(s.step?.options, ['稳定恋爱', '奔着结婚认真谈']);
    assert.equal(s.step?.skippable, false);
    assert.equal((await send(u, { key: 'target', skip: true })).statusCode, 400);
    assert.equal((await send(u, { key: 'target', value: '搭子' })).statusCode, 400);
    assert.equal((await send(u, { key: 'hobbies', value: ['徒步'] })).statusCode, 409);
  });

  it('按目标分叉：稳定恋爱问相处节奏，奔着结婚问结婚想法与家庭观', async () => {
    const love = await register(ctx.app);
    const next1 = (await send(love, { key: 'target', value: '稳定恋爱' })).json<State>();
    assert.equal(next1.step?.key, 'pace');
    const marry = await register(ctx.app);
    const next2 = (await send(marry, { key: 'target', value: '奔着结婚认真谈' })).json<State>();
    assert.equal(next2.step?.key, 'marriage_view');
    assert.equal(next1.total, STEPS.filter((s) => s.only !== '奔着结婚认真谈').length);
    assert.equal(next2.total, STEPS.filter((s) => s.only !== '稳定恋爱').length);
  });

  it('选项题不接受自造答案；可多选题接受自填爱好', async () => {
    const u = await register(ctx.app);
    await send(u, { key: 'target', value: '稳定恋爱' });
    assert.equal((await send(u, { key: 'pace', value: '随便' })).statusCode, 400);
    await send(u, { key: 'pace', skip: true });
    assert.equal((await send(u, { key: 'hobbies', value: '徒步' })).statusCode, 400);
    const ok = await send(u, { key: 'hobbies', value: ['徒步', '越野跑', '徒步'] });
    assert.equal(ok.statusCode, 200);
    const [p] = await sql<{ data: any }>('SELECT data FROM profiles WHERE user_id = $1', [u.id]);
    assert.deepEqual(p.data.stated.hobbies.value, ['徒步', '越野跑']);
    assert.equal(p.data.stated.hobbies.source, 'user');
  });

  it('跳过的题不再追问，转录里记为未回答；走完后 done', async () => {
    const u = await register(ctx.app);
    const s = await finish(u, { target: '奔着结婚认真谈', money_view: 'SKIP', occupation: 'SKIP' });
    assert.equal(s.done, true);
    assert.equal(s.step, null);
    assert.equal(s.answered, s.total);
    assert.equal(s.transcript.filter((t) => t.answer === null).length, 2);
    const [p] = await sql<{ data: any }>('SELECT data FROM profiles WHERE user_id = $1', [u.id]);
    assert.equal('money_view' in p.data.stated, false);
    assert.equal((await send(u, { key: 'conflict', value: '先让一步' })).statusCode, 409);
  });

  it('答案写入 stated 轨和连接目标，推荐直接用得上', async () => {
    const a = await register(ctx.app);
    const b = await register(ctx.app);
    const c = await register(ctx.app);
    const common = { target: '稳定恋爱', hobbies: ['攀岩', '摄影'], hometown: '杭州', comm_style: '直接坦诚', ideal_date: '一起逛展' };
    await finish(a, common);
    await finish(b, { ...common, hobbies: ['越野', '摄影'] });
    await finish(c, { target: '稳定恋爱', hobbies: ['游戏'], hometown: '成都', comm_style: '爱开玩笑', ideal_date: '看场电影', weekend: '宅家' });
    const [t] = await sql<{ target: string }>('SELECT target FROM connection_targets WHERE user_id = $1', [a.id]);
    assert.equal(t.target, '稳定恋爱');
    const picked = await pickCandidate(a.id, () => 0.99);
    assert.equal(picked?.candidate.id, b.id);
    assert.equal(picked?.scoreBreakdown.candidate_pool, 2);
    assert.ok(picked!.reasons.some((r) => r.includes('杭州')));
  });

  it('已有画像（含其他字段）时只补写本题，不覆盖', async () => {
    const u = await register(ctx.app);
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: auth(u),
      payload: { data: { stated: { vibe: { value: '安静', source: 'user', confidence: 1 } }, revealed: { x: { value: 'y', confidence: 0.4 } } } },
    });
    await send(u, { key: 'target', value: '稳定恋爱' });
    await send(u, { key: 'pace', value: '常联系，也各有空间' });
    const [p] = await sql<{ data: any }>('SELECT data FROM profiles WHERE user_id = $1', [u.id]);
    assert.equal(p.data.stated.vibe.value, '安静');
    assert.equal(p.data.stated.pace.value, '常联系，也各有空间');
    assert.equal(p.data.revealed.x.value, 'y');
    const s = await state(u);
    assert.equal(s.transcript.some((t) => t.answer === '安静'), true);
  });
});
