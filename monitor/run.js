// monitor/run.js
import { readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, slowScroll } from './lib/browser.js';
import { extractKeyword } from './scrape/keyword.js';
import { extractProduct } from './scrape/product.js';
import { extractShop } from './scrape/shop.js';
import { fetchFx } from './scrape/fx.js';
import { scanReviews } from './scrape/reviews.js';
import { updateSeries, buildHighlights } from './analyze.js';
import * as io from './lib/io.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.MONITOR_DATA ?? join(ROOT, 'data');
const OUT = process.env.MONITOR_OUT ?? join(ROOT, 'out');
const config = JSON.parse(readFileSync(join(ROOT, 'monitor.config.json'), 'utf8'));
const mode = process.argv[2];
const dry = process.argv.includes('--dry-run');
const today = new Date().toISOString().slice(0, 10);

const searchUrl = (q) => `https://www.tokopedia.com/search?st=product&q=${encodeURIComponent(q)}&ob=8`;

async function daily() {
  const keywords = dry ? config.keywords.slice(0, 1) : config.keywords;
  const products = dry ? config.products.slice(0, 2) : config.products;
  const shops = dry ? [] : config.shops;
  const snap = { date: today, keywords: {}, products: {}, shops: {}, fx: null, health: { blocked: false, errors: [] } };
  const b = await launch();
  try {
    for (const k of keywords) {
      const r = await b.visit(searchUrl(k.key));
      if (r === 'blocked') { snap.health.blocked = true; break; }
      if (r !== 'ok') { snap.health.errors.push(`keyword:${k.key}:${r}`); continue; }
      await slowScroll(b.page);
      try { snap.keywords[k.key] = await extractKeyword(b.page, k.topN); }
      catch (e) { snap.health.errors.push(`keyword:${k.key}:parse:${e.message}`); }
    }
    if (!snap.health.blocked) for (const p of products) {
      let r = await b.visit(p.url);
      if (r === 'error') { await new Promise((x) => setTimeout(x, 30000)); r = await b.visit(p.url); } // 重试1次
      if (r === 'blocked') { snap.health.blocked = true; break; }
      if (r !== 'ok') { snap.health.errors.push(`product:${p.id}:${r}`); continue; }
      try { snap.products[p.id] = await extractProduct(b.page); }
      catch (e) { snap.health.errors.push(`product:${p.id}:parse:${e.message}`); }
    }
    if (!snap.health.blocked) for (const sh of shops) {
      const r = await b.visit(sh.url);
      if (r === 'blocked') { snap.health.blocked = true; break; }
      if (r !== 'ok') { snap.health.errors.push(`shop:${sh.id}:${r}`); continue; }
      await slowScroll(b.page, 6);
      try { snap.shops[sh.id] = await extractShop(b.page); }
      catch (e) { snap.health.errors.push(`shop:${sh.id}:parse:${e.message}`); }
    }
  } finally { await b.close(); }
  snap.fx = await fetchFx();

  // appendSnapshot 对同日文件已存在时会抛错(快照只追加不覆盖);dry-run 重跑同日属正常场景,
  // 捕获后记日志继续走 series 更新,不视为失败。
  try { io.appendSnapshot(DATA, today, snap); }
  catch (e) { io.log(DATA, `appendSnapshot skipped: ${e.message}`); }

  const series = updateSeries(io.readSeries(DATA), snap, config);
  io.writeSeries(DATA, series);
  const highlights = buildHighlights(series, config, today);

  publish(series, highlights, snap.health);
  io.log(DATA, `daily done: kw=${Object.keys(snap.keywords).length} prod=${Object.keys(snap.products).length} shops=${Object.keys(snap.shops).length} blocked=${snap.health.blocked} errors=${snap.health.errors.length} highlights=${highlights.length}`);
  if (snap.health.blocked) process.exitCode = 2;
}

async function weekly() {
  const series = io.readSeries(DATA);
  const week = `${today.slice(0, 4)}-W${String(Math.ceil((new Date(today) - new Date(today.slice(0, 4) + '-01-01')) / 604800000)).padStart(2, '0')}`;
  const b = await launch();
  try {
    for (const p of config.products) {
      const r = await b.visit(p.url);
      if (r === 'blocked') break;
      if (r !== 'ok') continue;
      try {
        const rv = await scanReviews(b.page, config.negativeKeywords);
        series.reviews[p.id] ??= { points: [] };
        const pts = series.reviews[p.id].points;
        if (!(pts.length && pts[pts.length - 1].w === week)) pts.push({ w: week, ...rv });
      } catch (e) { io.log(DATA, `weekly:${p.id}:${e.message}`); }
    }
  } finally { await b.close(); }
  io.writeSeries(DATA, series);
  publish(series, buildHighlights(series, config, today), {});
  io.log(DATA, `weekly done`);
}

function publish(series, highlights, health) {
  const htmlSrc = join(ROOT, 'dashboard/competitor-monitor.html');
  if (!existsSync(htmlSrc)) {
    io.log(DATA, 'publish: dashboard html missing, skip publish');
    return;
  }

  try {
    const dataOut = join(OUT, 'monitor_data');
    mkdirSync(dataOut, { recursive: true });
    writeFileSync(join(dataOut, 'series.json'), JSON.stringify(series));
    writeFileSync(join(dataOut, 'highlights.json'), JSON.stringify({ date: today, items: highlights }));
    writeFileSync(join(dataOut, 'health.json'), JSON.stringify({ date: today, ...health }));
    copyFileSync(htmlSrc, join(OUT, 'competitor-monitor.html'));
  } catch (e) {
    io.log(DATA, 'publish failed: ' + e.message);
    process.exitCode = 3;
  }
}

if (mode === 'daily') await daily();
else if (mode === 'weekly') await weekly();
else { console.error('用法: node run.js daily|weekly [--dry-run]'); process.exit(1); }
