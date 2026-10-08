import { Pool } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { config } from '../config.js';

export const pool = new Pool({ connectionString: config.databaseUrl });
const transactionClient = new AsyncLocalStorage<PoolClient>();

type QueryFn = <T = any>(text: string, params?: any[]) => Promise<T[]>;

async function defaultQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
  const activeClient = transactionClient.getStore();
  if (activeClient) return (await activeClient.query(text, params)).rows as T[];
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/** All domain queries inside this callback share one transaction and its row locks. */
export async function withTransaction<T>(run: () => Promise<T>): Promise<T> {
  if (transactionClient.getStore()) return run();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionClient.run(client, run);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

let queryImpl: QueryFn = defaultQuery;

/** 仅测试用：替换 query 的底层实现（生产代码路径不变） */
export function _setQueryImpl(fn: QueryFn): void {
  queryImpl = fn;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  return queryImpl<T>(text, params);
}
