import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(dir, 'seed.sql'), 'utf8');
await pool.query(sql);
console.log('seed: 演示数据已写入（上线前请清空）');
await pool.end();
