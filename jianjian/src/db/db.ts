import { Pool } from 'pg';
import { config } from '../config.js';

export const pool = new Pool({ connectionString: config.databaseUrl });

type QueryFn = <T = any>(text: string, params?: any[]) => Promise<T[]>;

async function defaultQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
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
