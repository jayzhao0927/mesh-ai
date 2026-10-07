import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(dir, 'schema.sql'), 'utf8');
await pool.query(sql);
console.log('migrate: schema 已应用');
await pool.end();
