import { query } from '../db/db.js';
import { pickCandidate, weekKey } from '../matching.js';
import { notifyRecommendation } from '../notify.js';
import { shareLink } from '../routes/share.js';

// 每周推荐任务：npm run job:weekly
// 生产用云函数/系统 cron 每周触发一次；为每个有目标的用户生成本周推荐并触达

async function main() {
  const week = weekKey();
  const users = await query<{ id: string }>(
    `SELECT ct.user_id AS id FROM connection_targets ct
     WHERE NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.user_id = ct.user_id AND r.week = $1)`,
    [week],
  );
  console.log(`weekly: 本周待生成 ${users.length} 人`);
  for (const u of users) {
    try {
      const picked = await pickCandidate(u.id);
      if (!picked) {
        console.log(`weekly: ${u.id} 无合适候选人，跳过`);
        continue;
      }
      const rows = await query<{ link_token: string }>(
        `INSERT INTO recommendations (user_id, week, candidate_id, candidate_snapshot, reasons, score_breakdown)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING link_token`,
        [u.id, week, picked.candidate.id, JSON.stringify(picked.snapshot), JSON.stringify(picked.reasons), JSON.stringify(picked.scoreBreakdown)],
      );
      const link = shareLink('rec', rows[0].link_token);
      await notifyRecommendation(u.id, link);
      await notifyRecommendation(picked.candidate.id, link);
      console.log(`weekly: ${u.id} 已生成并触达`);
    } catch (err) {
      console.error(`weekly: ${u.id} 失败`, err);
    }
  }
  await import('../db/db.js').then((m) => m.pool.end());
}

main();
