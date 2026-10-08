import './env.js';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach } from 'node:test';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/db.js';

const TABLES = [
  'recommendation_response_events',
  'matching_states',
  'onboarding_skips',
  'notification_logs',
  'agent_shares',
  'video_rooms',
  'recommendation_intents',
  'recommendations',
  'invites',
  'profiles',
  'connection_targets',
  'agent_settings',
  'users',
];

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

export interface TestUser {
  id: string;
  token: string;
  phone: string;
}

export interface Ctx {
  app: FastifyInstance;
}

/** 每个测试文件调用一次：建库、建表、每个用例前清空 */
export function setupTestApp(): Ctx {
  const ctx = {} as Ctx;
  before(async () => {
    await ensureDatabase(process.env.DATABASE_URL!);
    const [{ db }] = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows;
    if (!db.endsWith('_test')) throw new Error(`拒绝在非测试库 ${db} 上跑测试（会清空数据）`);
    await pool.query(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
    ctx.app = await buildApp({ logger: false });
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  });
  after(async () => {
    await ctx.app?.close();
    await pool.end();
  });
  return ctx;
}

export async function sql<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

let phoneSeq = 0;

export async function register(app: FastifyInstance, nickname = ''): Promise<TestUser> {
  phoneSeq += 1;
  const phone = `139${String(phoneSeq).padStart(8, '0')}`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev-token', payload: { phone, nickname } });
  if (res.statusCode !== 200) throw new Error(`register failed: ${res.body}`);
  const body = res.json<{ token: string; userId: string }>();
  return { id: body.userId, token: body.token, phone };
}

export function auth(user: TestUser): Record<string, string> {
  return { authorization: `Bearer ${user.token}` };
}

type Stated = Record<string, string | string[]>;

export function profileData(stated: Stated): { stated: Record<string, unknown>; revealed: Record<string, unknown> } {
  return {
    stated: Object.fromEntries(
      Object.entries(stated).map(([k, value]) => [k, { value, source: 'user', confidence: 1 }]),
    ),
    revealed: {},
  };
}

/** 注册并建档；target 为 null 表示不选目标 */
export async function member(
  app: FastifyInstance,
  target: string | null,
  stated: Stated = {},
): Promise<TestUser> {
  const user = await register(app);
  const res = await app.inject({
    method: 'PUT',
    url: '/api/profile',
    headers: auth(user),
    payload: { data: profileData(stated), ...(target ? { target } : {}) },
  });
  if (res.statusCode !== 200) throw new Error(`profile failed: ${res.body}`);
  return user;
}

/** 写一条历史推荐（不同周），用于 30 天窗口测试 */
export async function pastRecommendation(viewerId: string, candidateId: string, daysAgo: number): Promise<void> {
  await sql(
    `INSERT INTO recommendations (user_id, week, candidate_id, candidate_snapshot, reasons, created_at)
     VALUES ($1, $2, $3, '{}'::jsonb, '[]'::jsonb, now() - make_interval(days => $4))`,
    [viewerId, `past-${daysAgo}`, candidateId, daysAgo],
  );
}
