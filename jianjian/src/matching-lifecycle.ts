import { query, withTransaction } from './db/db.js';

// One transaction lock coordinates expiry, generation, intents and scheduling.
// This also makes response accounting deterministic when multiple API workers run.
export async function lockMatchingLifecycle(): Promise<void> {
  await query('SELECT pg_advisory_xact_lock(7162048)');
}

export async function settleMatchingLifecycle(): Promise<void> {
  await withTransaction(async () => {
    await lockMatchingLifecycle();
    const events = await query<{ id: string; participant: string; responded: boolean }>(`
      SELECT r.id, p.participant,
             EXISTS (SELECT 1 FROM recommendation_intents i
               WHERE i.recommendation_id = r.id AND i.user_id = p.participant) AS responded
      FROM recommendations r
      CROSS JOIN LATERAL (VALUES (r.user_id), (r.candidate_id)) p(participant)
      WHERE r.status IN ('pending', 'passed') AND r.created_at <= now() - interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM recommendation_response_events e
          WHERE e.recommendation_id = r.id AND e.user_id = p.participant)
      ORDER BY r.created_at, r.id, p.participant
    `);
    for (const event of events) {
      await query(`INSERT INTO recommendation_response_events (recommendation_id, user_id, responded)
        VALUES ($1, $2, $3)`, [event.id, event.participant, event.responded]);
      await query(`INSERT INTO matching_states (user_id, no_response_streak)
        VALUES ($1, CASE WHEN $2 THEN 0 ELSE 1 END)
        ON CONFLICT (user_id) DO UPDATE SET
          no_response_streak = CASE WHEN $2 THEN 0 ELSE LEAST(3, matching_states.no_response_streak + 1) END,
          updated_at = now()`, [event.participant, event.responded]);
      await query(`UPDATE matching_states SET paused = true, updated_at = now()
        WHERE user_id = $1 AND no_response_streak = 3`, [event.participant]);
    }
    await query(`UPDATE recommendations SET status = 'expired'
      WHERE status IN ('pending', 'passed') AND created_at <= now() - interval '24 hours'`);

    const released = await query<{ id: string }>(`
      UPDATE recommendations r SET status = 'expired'
      WHERE r.status = 'mutual' AND (
        (r.mutual_at <= now() - interval '24 hours' AND NOT EXISTS (
          SELECT 1 FROM video_rooms v WHERE v.recommendation_id = r.id
            AND v.scheduled_at IS NOT NULL AND v.status <> 'cancelled'
        )) OR
        (r.mutual_at <= now() - interval '48 hours' AND NOT EXISTS (
          SELECT 1 FROM video_rooms v WHERE v.recommendation_id = r.id
            AND v.completed_at IS NOT NULL AND v.completed_at <= r.mutual_at + interval '48 hours'
        )) OR
        EXISTS (SELECT 1 FROM video_rooms v WHERE v.recommendation_id = r.id
          AND v.completed_at IS NOT NULL AND v.reviewed_at IS NOT NULL)
      ) RETURNING r.id
    `);
    if (released.length) await query(`UPDATE video_rooms SET status = 'cancelled'
      WHERE recommendation_id = ANY($1::uuid[]) AND completed_at IS NULL`, [released.map(r => r.id)]);
  });
}

export async function resetResponseStreak(userId: string): Promise<void> {
  await query(`INSERT INTO matching_states (user_id) VALUES ($1)
    ON CONFLICT (user_id) DO UPDATE SET no_response_streak = 0, updated_at = now()`, [userId]);
}

/** Explicit chat command only; a normal message, login or profile edit never resumes matching. */
export async function resumeMatching(userId: string): Promise<void> {
  await withTransaction(async () => {
    await settleMatchingLifecycle();
    await query(`INSERT INTO matching_states (user_id) VALUES ($1)
      ON CONFLICT (user_id) DO UPDATE SET paused = false, no_response_streak = 0, updated_at = now()`, [userId]);
  });
}

/** Internal provider integration only. Do not expose unverified completion as a public API. */
export async function recordVideoCompletion(roomId: string, completedAt: Date): Promise<boolean> {
  return withTransaction(async () => {
    await settleMatchingLifecycle();
    const rows = await query(`UPDATE video_rooms v SET completed_at = $2, status = 'done'
      FROM recommendations r WHERE v.recommendation_id = r.id AND v.room_id = $1
        AND r.status = 'mutual' AND v.scheduled_at IS NOT NULL
        AND $2::timestamptz >= v.scheduled_at AND $2::timestamptz <= now()
        AND $2::timestamptz <= r.mutual_at + interval '48 hours'
        AND v.completed_at IS NULL RETURNING v.id`, [roomId, completedAt]);
    return rows.length > 0;
  });
}

/** Invoked by the future review flow after the review has actually been saved. */
export async function recordVideoReview(roomId: string): Promise<boolean> {
  return withTransaction(async () => {
    await settleMatchingLifecycle();
    const rows = await query(`UPDATE video_rooms SET reviewed_at = now()
      WHERE room_id = $1 AND completed_at IS NOT NULL AND reviewed_at IS NULL RETURNING id`, [roomId]);
    await settleMatchingLifecycle();
    return rows.length > 0;
  });
}
