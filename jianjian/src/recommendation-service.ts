import { query, withTransaction } from './db/db.js';
import { pickCandidate, weekKey } from './matching.js';
import { ACTIVE_RECOMMENDATION_SQL } from './recommendation-lifecycle.js';
import { settleMatchingLifecycle } from './matching-lifecycle.js';

type Generation =
  | { ok: true; id: string; linkToken: string; candidateId: string }
  | { ok: false; reason: 'occupied' | 'paused' | 'no_candidate' };

export async function generateRecommendation(userId: string): Promise<Generation> {
  return withTransaction(async () => {
    await settleMatchingLifecycle();
    const states = await query<{ paused: boolean }>('SELECT paused FROM matching_states WHERE user_id = $1', [userId]);
    if (states[0]?.paused) return { ok: false, reason: 'paused' };
    const picked = await pickCandidate(userId);
    // Lock both participants in a stable order; opposite-direction generation cannot deadlock.
    const participants = picked ? [userId, picked.candidate.id] : [userId];
    await query('SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [participants]);
    const occupied = await query<{ user_id: string; candidate_id: string }>(
      `SELECT r.user_id, r.candidate_id FROM recommendations r
       WHERE (r.user_id = ANY($1::uuid[]) OR r.candidate_id = ANY($1::uuid[]))
         AND ${ACTIVE_RECOMMENDATION_SQL}`,
      [participants],
    );
    if (occupied.some(r => r.user_id === userId || r.candidate_id === userId)) {
      return { ok: false, reason: 'occupied' };
    }
    const week = weekKey();
    if (!picked || occupied.length) return { ok: false, reason: 'no_candidate' };
    const [row] = await query<{ id: string; link_token: string }>(
      `INSERT INTO recommendations (user_id, week, candidate_id, candidate_snapshot, reasons, score_breakdown)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id, link_token`,
      [userId, week, picked.candidate.id, JSON.stringify(picked.snapshot), JSON.stringify(picked.reasons), JSON.stringify(picked.scoreBreakdown)],
    );
    return { ok: true, id: row.id, linkToken: row.link_token, candidateId: picked.candidate.id };
  });
}
