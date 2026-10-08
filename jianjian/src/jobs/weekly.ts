import { pool } from '../db/db.js';
import { runMatchingCycle } from '../matching-cycle.js';

// Legacy command retained for callers; matching no longer has a weekly quota.
try { await runMatchingCycle(); }
finally { await pool.end(); }
