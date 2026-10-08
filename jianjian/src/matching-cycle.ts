import { query } from './db/db.js';
import { settleMatchingLifecycle } from './matching-lifecycle.js';
import { generateRecommendation } from './recommendation-service.js';
import { notifyRecommendation } from './notify.js';
import { shareLink } from './routes/share.js';

/** Restart-safe sweep and refill. Each recommendation is committed before notification. */
export async function runMatchingCycle(): Promise<void> {
  await settleMatchingLifecycle();
  const users = await query<{ id: string }>('SELECT user_id AS id FROM connection_targets ORDER BY user_id');
  for (const user of users) {
    const generated = await generateRecommendation(user.id);
    if (!generated.ok) continue;
    const link = shareLink('rec', generated.linkToken);
    await notifyRecommendation(user.id, link);
    await notifyRecommendation(generated.candidateId, link);
  }
}
