import { query } from './db/db.js';

export const DEFAULT_AGENT_NAME = '见见';

export async function getAgentName(userId: string): Promise<string> {
  const rows = await query<{ agent_name: string }>('SELECT agent_name FROM agent_settings WHERE user_id = $1', [userId]);
  return rows[0]?.agent_name ?? DEFAULT_AGENT_NAME;
}
