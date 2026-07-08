import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, appendFileSync } from 'node:fs';
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
  writeFileSync(f, JSON.stringify(series));
}

export function log(dataDir, line) {
  const dir = join(dataDir, 'logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, new Date().toISOString().slice(0, 10) + '.log'),
    `[${new Date().toISOString()}] ${line}\n`);
}
