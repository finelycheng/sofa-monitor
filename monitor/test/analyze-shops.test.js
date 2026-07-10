// monitor/test/analyze-shops.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateShopSeries, shopHighlights } from '../analyze-shops.js';

const snap = (date, prods) => ({ date, shop: 's1', shopName: 'S1', products: prods });
const P = (id, rank, over = {}) => ({ productId: id, rank, name: 'P' + id, url: 'https://x/' + id,
  imageUrl: '', soldBucket: '1rb+', soldValue: 1000, rating: 4.9, ratingCount: 100, negKw: {}, ...over });

test('updateShopSeries 追加快照且幂等', () => {
  let s = updateShopSeries(undefined, snap('2026-07-10', [P('a', 1), P('b', 2)]));
  s = updateShopSeries(s, snap('2026-07-10', [P('a', 1), P('b', 2)])); // 同日重跑
  assert.equal(s.s1.snapshots.length, 1);
  s = updateShopSeries(s, snap('2026-07-11', [P('a', 1)]));
  assert.equal(s.s1.snapshots.length, 2);
});

test('shopHighlights: 上新 + 掉榜 + 销量跳桶', () => {
  let s = updateShopSeries(undefined, snap('2026-07-10', [P('a', 1), P('b', 2)]));
  s = updateShopSeries(s, snap('2026-07-11', [
    P('a', 1, { soldBucket: '2rb+', soldValue: 2000 }), // 跳桶
    P('c', 2), // 上新(b 掉榜)
  ]));
  const h = shopHighlights(s, 's1', '2026-07-11');
  assert.ok(h.some((x) => x.icon === '✨' && /Pc/.test(x.text)), '上新c');
  assert.ok(h.some((x) => x.icon === '📉' && /Pb/.test(x.text)), '掉榜b');
  assert.ok(h.some((x) => x.icon === '📈' && /Pa/.test(x.text)), '跳桶a');
});
