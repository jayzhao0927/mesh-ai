import './env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertNoDigits, buildReasons, containsDigit, inferTraits, pickCandidate, publicStatus, sanitizeSnapshot } from '../src/matching.js';
import { auth, member, pastRecommendation, setupTestApp, sql } from './helpers.js';

const ctx = setupTestApp();
const EXPLOIT = () => 0.99;
const EXPLORE = () => 0;

describe('目标硬过滤', () => {
  it('只召回目标一致的人，目标不同或未选目标的人不进候选池', async () => {
    const viewer = await member(ctx.app, '稳定恋爱', { hometown: '杭州' });
    const same = await member(ctx.app, '稳定恋爱', { hometown: '成都' });
    await member(ctx.app, '奔着结婚认真谈', { hometown: '杭州' });
    await member(ctx.app, null, { hometown: '杭州' });
    for (const rng of [EXPLOIT, EXPLORE]) {
      const picked = await pickCandidate(viewer.id, rng);
      assert.ok(picked);
      assert.equal(picked.candidate.id, same.id);
      assert.equal(picked.scoreBreakdown.candidate_pool, 1);
    }
  });

  it('自己没选目标时不推荐任何人', async () => {
    const viewer = await member(ctx.app, null);
    await member(ctx.app, '稳定恋爱');
    assert.equal(await pickCandidate(viewer.id), null);
  });

  it('只有目标不同的人时返回暂无候选', async () => {
    const viewer = await member(ctx.app, '奔着结婚认真谈');
    await member(ctx.app, '稳定恋爱');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(viewer) });
    assert.equal(res.statusCode, 404);
  });
});

describe('一次只推一人', () => {
  it('生成接口只返回一个推荐，同一周再生成 409，当前推荐是单个对象', async () => {
    const viewer = await member(ctx.app, '稳定恋爱');
    await member(ctx.app, '稳定恋爱');
    await member(ctx.app, '稳定恋爱');
    const first = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(viewer) });
    assert.equal(first.statusCode, 200);
    const second = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(viewer) });
    assert.equal(second.statusCode, 409);
    const current = await ctx.app.inject({ method: 'GET', url: '/api/recommendations/current', headers: auth(viewer) });
    const body = current.json();
    assert.equal(Array.isArray(body), false);
    assert.equal(body.id, first.json().id);
    const rows = await sql('SELECT id FROM recommendations WHERE user_id = $1', [viewer.id]);
    assert.equal(rows.length, 1);
  });
});

describe('30 天不重推', () => {
  it('30 天内推荐过的人不再进入候选池', async () => {
    const viewer = await member(ctx.app, '稳定恋爱');
    const recent = await member(ctx.app, '稳定恋爱');
    await pastRecommendation(viewer.id, recent.id, 29);
    assert.equal(await pickCandidate(viewer.id), null);
  });

  it('超过 30 天的可以重新进入候选池', async () => {
    const viewer = await member(ctx.app, '稳定恋爱');
    const old = await member(ctx.app, '稳定恋爱');
    await pastRecommendation(viewer.id, old.id, 31);
    const picked = await pickCandidate(viewer.id);
    assert.equal(picked?.candidate.id, old.id);
  });
});

describe('推荐理由 / 推荐卡禁数字', () => {
  it('违规数字直接断言失败', () => {
    assert.throws(() => assertNoDigits(['你们身高差 15 厘米']), /不得包含数字/);
    assert.throws(() => assertNoDigits(['年收入３０万']), /不得包含数字/);
    assert.doesNotThrow(() => assertNoDigits(['你们都喜欢徒步']));
  });

  it('画像里带数字的值不进理由（整条不出，不留残字）', () => {
    const viewer = { stated: { hometown: { value: '杭州1区' }, hobbies: { value: ['徒步5公里'] } } };
    const candidate = { profile: { stated: { hometown: { value: '杭州1区' }, hobbies: { value: ['徒步5公里'] } } } };
    const reasons = buildReasons(viewer, candidate);
    assert.deepEqual(reasons, ['你们的生活节奏和期待的连接方式很合拍']);
  });

  it('推荐卡快照只保留展示字段：无身高收入、无置信度、无 revealed 推断，含数字的值整条不出', () => {
    const snap = sanitizeSnapshot({
      stated: {
        hometown: { value: '杭州', confidence: 0.9 },
        height: { value: '180', confidence: 1 },
        income: { value: '30万', confidence: 1 },
        occupation: { value: '工程师3年', confidence: 1 },
        vibe: { value: '身高１８０cm', confidence: 1 },
        hobbies: { value: ['徒步', '逛展2小时', '摄影'], confidence: 1 },
      },
      revealed: { vibe: { value: '安静', confidence: 0.4 } },
    });
    assert.deepEqual(snap, { stated: { hometown: { value: '杭州' }, hobbies: { value: ['徒步', '摄影'] } }, revealed: {} });
  });

  it('真实接口返回的推荐卡与分享页都不含任何数字和打分', async () => {
    const viewer = await member(ctx.app, '稳定恋爱', { hometown: '杭州', hobbies: ['徒步', '摄影'], height: '175' });
    await member(ctx.app, '稳定恋爱', { hometown: '杭州', hobbies: ['徒步'], height: '180', income: '50万' });
    const gen = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(viewer) });
    assert.equal(gen.statusCode, 200);
    const current = await ctx.app.inject({ method: 'GET', url: '/api/recommendations/current', headers: auth(viewer) });
    const card = current.json();
    const token = String(gen.json().link).split('/').pop();
    const share = (await ctx.app.inject({ method: 'GET', url: `/s/rec/${token}` })).json();
    for (const shown of [card, share]) {
      assert.equal(containsDigit(JSON.stringify(shown.reasons)), false);
      assert.equal(containsDigit(JSON.stringify(shown.candidate_snapshot)), false);
      assert.equal('score_breakdown' in shown, false);
    }
    assert.ok((card.reasons as string[]).some((r) => r.includes('杭州')));
  });
});

describe('p_mutual 分值落库', () => {
  it('score_breakdown 四项分值与 p_mutual 调和平均写入 recommendations', async () => {
    const viewer = await member(ctx.app, '稳定恋爱', { hometown: '杭州', hobbies: ['徒步'], vibe: '安静' });
    const cand = await member(ctx.app, '稳定恋爱', { hometown: '杭州', hobbies: ['徒步'], vibe: '安静' });
    const gen = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(viewer) });
    assert.equal(gen.statusCode, 200);
    const [row] = await sql<{ candidate_id: string; score_breakdown: Record<string, unknown> }>(
      'SELECT candidate_id, score_breakdown FROM recommendations WHERE id = $1',
      [gen.json().id],
    );
    assert.equal(row.candidate_id, cand.id);
    const sb = row.score_breakdown as Record<string, number | string | boolean>;
    assert.equal(sb.version, 'p_mutual-v1');
    for (const k of ['alignment_ab', 'chemistry_ab', 'alignment_ba', 'chemistry_ba', 'p_ab', 'p_ba', 'p_mutual']) {
      assert.equal(typeof sb[k], 'number', k);
      assert.ok((sb[k] as number) >= 0 && (sb[k] as number) <= 1, k);
    }
    const pAb = sb.p_ab as number;
    const pBa = sb.p_ba as number;
    assert.ok(Math.abs((sb.p_mutual as number) - (2 * pAb * pBa) / (pAb + pBa)) < 0.002);
    assert.ok(Math.abs(pAb - (0.6 * (sb.alignment_ab as number) + 0.4 * (sb.chemistry_ab as number))) < 0.002);
    assert.equal(typeof sb.explored, 'boolean');
    assert.equal(sb.candidate_pool, 1);
  });

  it('非探索时取 p_mutual 最高的人', async () => {
    const viewer = await member(ctx.app, '稳定恋爱', { hometown: '杭州', hobbies: ['徒步'], money_view: '务实' });
    const best = await member(ctx.app, '稳定恋爱', { hometown: '杭州', hobbies: ['徒步'], money_view: '务实' });
    await member(ctx.app, '稳定恋爱', { hometown: '成都', hobbies: ['阅读'] });
    const picked = await pickCandidate(viewer.id, EXPLOIT);
    assert.equal(picked?.candidate.id, best.id);
    assert.equal(picked?.scoreBreakdown.explored, false);
  });
});

describe('底色（潜在特质）', () => {
  it('表面爱好不同、底色一致：攀岩 vs 越野都推断为冒险', () => {
    assert.deepEqual(inferTraits(['攀岩']), [{ trait: '冒险', score: 1 }]);
    assert.deepEqual(inferTraits(['越野']), [{ trait: '冒险', score: 1 }]);
    assert.deepEqual(inferTraits([]), []);
    assert.deepEqual(inferTraits(['看云发呆']), []);
  });

  it('底色一致的人比底色不同的人分高；traits 记入 score_breakdown', async () => {
    const viewer = await member(ctx.app, '稳定恋爱', { hobbies: ['攀岩'] });
    const sameTrait = await member(ctx.app, '稳定恋爱', { hobbies: ['越野'] });
    await member(ctx.app, '稳定恋爱', { hobbies: ['追剧'] });
    const picked = await pickCandidate(viewer.id, EXPLOIT);
    assert.equal(picked?.candidate.id, sameTrait.id);
    assert.deepEqual(picked?.scoreBreakdown.traits_ab, ['冒险']);
    assert.deepEqual(picked?.scoreBreakdown.traits_ba, ['冒险']);
  });

  it('底色不向用户展示：推荐卡、理由、分享页都不含底色', async () => {
    const viewer = await member(ctx.app, '稳定恋爱', { hobbies: ['攀岩'] });
    await member(ctx.app, '稳定恋爱', { hobbies: ['越野'] });
    const gen = await ctx.app.inject({ method: 'POST', url: '/api/recommendations/generate', headers: auth(viewer) });
    const [row] = await sql<{ score_breakdown: Record<string, unknown> }>('SELECT score_breakdown FROM recommendations WHERE id = $1', [gen.json().id]);
    assert.deepEqual(row.score_breakdown.traits_ab, ['冒险']);
    const token = String(gen.json().link).split('/').pop();
    const shown = [
      (await ctx.app.inject({ method: 'GET', url: '/api/recommendations/current', headers: auth(viewer) })).body,
      (await ctx.app.inject({ method: 'GET', url: `/s/rec/${token}` })).body,
      (await ctx.app.inject({ method: 'GET', url: `/api/recommendations/by-token/${token}`, headers: auth(viewer) })).body,
    ];
    for (const body of shown) {
      assert.equal(body.includes('冒险'), false);
      assert.equal(body.includes('traits'), false);
    }
  });
});

describe('publicStatus', () => {
  it('pass 对外与等待中无法区分', () => {
    assert.equal(publicStatus('passed'), 'pending');
    assert.equal(publicStatus('pending'), 'pending');
    assert.equal(publicStatus('mutual'), 'mutual');
  });
});
