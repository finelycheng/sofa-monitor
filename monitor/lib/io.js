import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, appendFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function appendSnapshot(dataDir, dateStr, obj) {
  const dir = join(dataDir, 'snapshots');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${dateStr}.json`);
  if (existsSync(f)) throw new Error(`snapshot exists: ${f}(快照只追加,不覆盖)`);
  writeFileSync(f, JSON.stringify(obj, null, 1));
}

export function readSeries(dataDir) {
  const f = join(dataDir, 'series.json');
  if (!existsSync(f)) return { products: {}, keywords: {}, fx: { points: [] }, reviews: {} };
  return JSON.parse(readFileSync(f, 'utf8'));
}

export function writeSeries(dataDir, series) {
  mkdirSync(dataDir, { recursive: true });
  const f = join(dataDir, 'series.json');
  if (existsSync(f)) copyFileSync(f, f + '.bak');
  // 原子写:先写临时文件再 rename,避免进程中途崩溃时 series.json 被截断/损坏。
  const tmp = f + '.tmp';
  writeFileSync(tmp, JSON.stringify(series));
  renameSync(tmp, f);
}

export function log(dataDir, line) {
  const dir = join(dataDir, 'logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, new Date().toISOString().slice(0, 10) + '.log'),
    `[${new Date().toISOString()}] ${line}\n`);
}
