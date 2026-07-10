// monitor/shop-run.js
import { readFileSync, mkdirSync, copyFileSync, cpSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, slowScroll, withTimeout } from './lib/browser.js';
import { extractShopTop, extractProductProfile } from './scrape/shopProfile.js';
import { extractReviews } from './scrape/productReviews.js';
import { analyzePlaybook } from './scrape/playbookAnalyzer.js';
import { updateShopSeries, shopHighlights } from './analyze-shops.js';
import * as io from './lib/io.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.MONITOR_DATA ?? join(ROOT, 'data');
const OUT = process.env.MONITOR_OUT ?? join(ROOT, 'out');
const config = JSON.parse(readFileSync(join(ROOT, 'monitor.config.json'), 'utf8'));
const NEG = config.negativeKeywords;
const mode = process.argv[2];
const dry = process.argv.includes('--dry-run');
const today = new Date().toISOString().slice(0, 10);
const week = `${today.slice(0, 4)}-W${String(Math.ceil((new Date(today) - new Date(today.slice(0, 4) + '-01-01')) / 604800000)).padStart(2, '0')}`;
const sortedUrl = (shopUrl) => `${shopUrl}/product?sort=8`; // Task1 fixture 确认的销量排序

function readJson(p, dflt) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; }
function writeJson(p, obj) { mkdirSync(dirname(p), { recursive: true }); const t = p + '.tmp'; writeFileSync(t, JSON.stringify(obj)); renameSync(t, p); }

async function shopDaily() {
  const profiles = dry ? config.shopProfiles.slice(0, 1) : config.shopProfiles;
  const b = await launch();
  let seriesPath = join(DATA, 'shop-series.json');
  let series = readJson(seriesPath, {});
  try {
    for (const sp of profiles) {
      const r = await b.visit(sortedUrl(sp.shopUrl));
      if (r === 'blocked') { io.log(DATA, `shop:${sp.id}:blocked`); break; }
      if (r !== 'ok') { io.log(DATA, `shop:${sp.id}:${r}`); continue; }
      let top;
      try { await withTimeout(slowScroll(b.page), 60000, `sc:${sp.id}`); top = await withTimeout(extractShopTop(b.page, dry ? 3 : sp.topN), 60000, `top:${sp.id}`); }
      catch (e) { io.log(DATA, `shop:${sp.id}:top:${e.message}`); continue; }
      const products = [];
      for (const t of top) {
        const pr = await b.visit(t.url);
        if (pr === 'blocked') { io.log(DATA, `shop:${sp.id}:prod:blocked`); break; }
        if (pr !== 'ok') continue;
        try {
          const prof = await withTimeout(extractProductProfile(b.page), 60000, `prof:${t.productId}`);
          // 复用评论区低星关键词计数(轻量,聚合)
          const negKw = await withTimeout(countNeg(b.page, NEG), 60000, `neg:${t.productId}`).catch(() => ({}));
          products.push({ rank: t.rank, productId: t.productId, name: prof.titleFull || t.name, url: t.url,
            imageUrl: prof.mainImages?.[0] || t.imageUrl, soldBucket: prof.soldBucket ?? t.soldBucket,
            soldValue: prof.soldValue ?? t.soldValue, rating: prof.rating, ratingCount: prof.ratingCount,
            price: prof.priceIdr, discount: prof.discount, variantCount: prof.variants?.length ?? 0,
            description: prof.description, variants: prof.variants,
            trust: prof.trust, negKw });
        } catch (e) { io.log(DATA, `shop:${sp.id}:prod:${t.productId}:${e.message}`); }
      }
      const snap = { date: today, shop: sp.id, shopName: sp.name, products };
      writeJson(join(DATA, 'shops', `${sp.id}.json`), { ...(readJson(join(DATA, 'shops', `${sp.id}.json`), { snapshots: [] })), shop: sp.id, shopName: sp.name, snapshots: [...readJson(join(DATA, 'shops', `${sp.id}.json`), { snapshots: [] }).snapshots.slice(-89).filter(s=>s.date!==today), { date: today, products }] });
      series = updateShopSeries(series, snap);
      writeJson(seriesPath, series); // 每店落盘一次(部分成功留数据)
    }
  } finally { await b.close(); }
  publishShops(series);
  io.log(DATA, `shop-daily done: shops=${Object.keys(series).length}`);
}

async function countNeg(page, negKw) {
  await slowScroll(page, 6);
  const texts = await page.evaluate(() => [...document.querySelectorAll('article')].map((n) => n.innerText).filter((t) => /lalu/.test(t)));
  const kw = {}; for (const k of negKw) kw[k] = texts.filter((t) => t.toLowerCase().includes(k)).length;
  return kw;
}

async function shopWeekly() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const profiles = dry ? config.shopProfiles.slice(0, 1) : config.shopProfiles;
  const b = await launch();
  const cards = readJson(join(DATA, 'shop-cards', `${week}.json`), {});
  try {
    for (const sp of profiles) {
      const shopFile = readJson(join(DATA, 'shops', `${sp.id}.json`), { snapshots: [] });
      const last = shopFile.snapshots[shopFile.snapshots.length - 1];
      if (!last) continue;
      for (const p of (dry ? last.products.slice(0, 2) : last.products)) {
        const r = await b.visit(p.url);
        if (r === 'blocked') break;
        if (r !== 'ok') continue;
        let reviews = [];
        try { await withTimeout(slowScroll(b.page, 10), 90000, `rv-sc:${p.productId}`); reviews = await withTimeout(extractReviews(b.page, 50), 90000, `rv:${p.productId}`); }
        catch (e) { io.log(DATA, `weekly:rv:${p.productId}:${e.message}`); }
        writeJson(join(DATA, 'shop-reviews', `${p.productId}.json`), { productId: p.productId, name: p.name,
          weeks: [...readJson(join(DATA, 'shop-reviews', `${p.productId}.json`), { weeks: [] }).weeks.filter((w) => w.week !== week), { week, reviews }] });
        if (apiKey) {
          const card = await analyzePlaybook({ ...p, titleFull: p.name, priceIdr: p.price }, reviews, { apiKey });
          if (card) cards[p.productId] = { ...card, name: p.name, shop: sp.id, week };
          writeJson(join(DATA, 'shop-cards', `${week}.json`), cards); // 增量落盘
        }
      }
    }
  } finally { await b.close(); }
  const series = readJson(join(DATA, 'shop-series.json'), {});
  publishShops(series, cards);
  io.log(DATA, `shop-weekly done: cards=${Object.keys(cards).length}`);
}

function publishShops(series, cards) {
  const htmlSrc = join(ROOT, 'dashboard/shop-profiles.html');
  if (!existsSync(htmlSrc)) { io.log(DATA, 'shop publish: html missing'); return; }
  try {
    const d = join(OUT, 'shop_data'); mkdirSync(d, { recursive: true });
    const hi = {}; for (const id of Object.keys(series)) hi[id] = shopHighlights(series, id, today);
    writeFileSync(join(d, 'shop-series.json'), JSON.stringify(series));
    writeFileSync(join(d, 'shop-highlights.json'), JSON.stringify({ date: today, byShop: hi }));
    // 汇总最近一周画像卡
    const cardsDir = join(DATA, 'shop-cards');
    let allCards = cards || {};
    if (!cards && existsSync(cardsDir)) { const f = readdirSync(cardsDir).sort().pop(); if (f) allCards = JSON.parse(readFileSync(join(cardsDir, f), 'utf8')); }
    writeFileSync(join(d, 'shop-cards.json'), JSON.stringify(allCards));
    const reviewsSrc = join(DATA, 'shop-reviews');
    if (existsSync(reviewsSrc)) cpSync(reviewsSrc, join(d, 'reviews'), { recursive: true });
    copyFileSync(htmlSrc, join(OUT, 'shop-profiles.html'));
  } catch (e) { io.log(DATA, 'shop publish failed: ' + e.message); process.exitCode = 3; }
}

if (mode === 'shop-daily') await shopDaily();
else if (mode === 'shop-weekly') await shopWeekly();
else { console.error('用法: node shop-run.js shop-daily|shop-weekly [--dry-run]'); process.exit(1); }
