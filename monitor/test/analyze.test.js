import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateSeries, buildHighlights } from '../analyze.js';

const config = {
  thresholds: { priceChangePct: 5, rankShift: 5, ratingCountAccel: 1.5, fxChangePct: 3, missingDays: 2, restockMin: 20 },
  products: [{ id: 'p1', label: 'P1', primaryKeyword: 'kw', trackStock: true, url: 'https://x/p1' }],
  keywords: [{ key: 'kw', topN: 20 }],
  campaignCalendar: [],
};
const snapDay = (d, over = {}) => ({
  date: d,
  keywords: { kw: [{ rank: 1, url: 'https://x/p1', title: 'P1', priceIdr: 100000, soldBucket: '1rb+', soldValue: 1000, rating: 4.9, shopName: 's', city: 'c' }] },
  products: { p1: { ok: true, priceIdr: 100000, originalPriceIdr: 120000, soldBucket: '1rb+', soldValue: 1000, rating: 4.9, ratingCount: 100, stock: 80, variants: ['A', 'B'], origin: 'Kota X' } },
  shops: {}, fx: { idrPerCny: 2200 }, health: {},
  ...over,
});

test('updateSeries 追加点并计算派生指标', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, stock: 74, priceIdr: 90000 } },
  }), config);
  const pts = s.products.p1.points;
  assert.equal(pts.length, 2);
  assert.equal(s.derived.products.p1.dailySales, 6);          // 80-74 库存差=精确日销
  assert.equal(s.derived.products.p1.restock, false);
  assert.equal(s.derived.products.p1.discountPct, 25);        // (120000-90000)/120000
  assert.equal(s.derived.keywords.kw.medianPrice, 100000);
});

test('updateSeries 同日重跑幂等(不重复追点)', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-08'), config);
  assert.equal(s.products.p1.points.length, 1);
});

test('库存上跳识别为 restock 而非负日销', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, stock: 300 } },
  }), config);
  assert.equal(s.derived.products.p1.restock, true);
  assert.equal(s.derived.products.p1.dailySales, null);
});

test('规则:价格异动≥5% 触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, priceIdr: 90000 } },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '💰' && /P1/.test(x.text) && /-10/.test(x.text)));
});

test('规则:销量跳桶触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, soldBucket: '2rb+', soldValue: 2000 } },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '📈' && /1rb\+ → 2rb\+/.test(x.text)));
});

test('规则:新玩家进 Top10 触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    keywords: { kw: [
      { rank: 1, url: 'https://x/newcomer', title: 'NEW', priceIdr: 88000, soldBucket: null, soldValue: null, rating: null, shopName: 'n', city: 'c' },
      ...snapDay('x').keywords.kw.map((i) => ({ ...i, rank: 2 })),
    ] },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '🆕' && /newcomer|NEW/.test(x.text + x.url)));
});

test('规则:变体增减触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, variants: ['A', 'B', 'C'] } },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '🎨' && /\+C/.test(x.text)));
});

test('规则:连续缺数触发红条', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  // 07-09、07-10 两天没有 p1 数据(快照里 products 为空)
  s = updateSeries(s, snapDay('2026-07-09', { products: {} }), config);
  s = updateSeries(s, snapDay('2026-07-10', { products: {} }), config);
  const h = buildHighlights(s, config, '2026-07-10');
  assert.ok(h.some((x) => x.level === 'red' && x.icon === '⚠️' && /P1/.test(x.text)));
});
