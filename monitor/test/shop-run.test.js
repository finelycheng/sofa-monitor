import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProductRecord } from '../shop-run.js';

// mock: extractProductProfile() 返回值
const prof = {
  ok: true,
  titleFull: 'MeeXi Sofabed Density 23 Vacuum',
  description: 'sofa bed minimalis empuk tahan lama',
  mainImages: ['https://images.tokopedia.net/img1.jpg'],
  priceIdr: 1220000,
  originalPriceIdr: 1900000,
  discount: 36,
  soldBucket: '1rb+', soldValue: 1000,
  rating: 4.8, ratingCount: 320,
  variants: ['Abu', 'Biru'],
  trust: { cod: true, cicil: true, freeOngkir: false, garansi: true, shopTier: 'Power Merchant', origin: 'Bandung', shipEta: '2-3 hari' },
};

// mock: extractShopTop() 条目
const top = {
  rank: 1, productId: '12345', name: 'MeeXi Sofabed (listing name)',
  url: 'https://www.tokopedia.com/meexi/sofabed-density-23',
  imageUrl: 'https://images.tokopedia.net/thumb.jpg',
  soldBucket: '900+', soldValue: 900,
};

test('buildProductRecord 保留划线原价/折扣(Task 第3次回归的字段)', () => {
  const rec = buildProductRecord(prof, top);
  assert.equal(rec.originalPriceIdr, 1900000);
  assert.equal(rec.discount, 36);
});

test('buildProductRecord 锁死此前静默丢过的字段: description/variants/price/trust', () => {
  const rec = buildProductRecord(prof, top);
  assert.equal(rec.description, prof.description);
  assert.deepEqual(rec.variants, prof.variants);
  assert.equal(rec.price, prof.priceIdr);
  assert.deepEqual(rec.trust, prof.trust);
});

test('buildProductRecord 组装完整快照(rank/productId/url/imageUrl/sold/rating等取自prof优先,回退top)', () => {
  const rec = buildProductRecord(prof, top, { kempes: 2 });
  assert.equal(rec.rank, 1);
  assert.equal(rec.productId, '12345');
  assert.equal(rec.name, prof.titleFull);
  assert.equal(rec.url, top.url);
  assert.equal(rec.imageUrl, prof.mainImages[0]);
  assert.equal(rec.soldBucket, prof.soldBucket);
  assert.equal(rec.soldValue, prof.soldValue);
  assert.equal(rec.rating, prof.rating);
  assert.equal(rec.ratingCount, prof.ratingCount);
  assert.equal(rec.variantCount, prof.variants.length);
  assert.deepEqual(rec.negKw, { kempes: 2 });
});

test('buildProductRecord 在 prof 字段缺失时回退到 top 的字段(标题/图片/销量)', () => {
  const thinProf = { ok: true, titleFull: '', description: '', mainImages: [], priceIdr: 500000,
    originalPriceIdr: null, discount: null, soldBucket: null, soldValue: null,
    rating: null, ratingCount: null, variants: [], trust: {} };
  const rec = buildProductRecord(thinProf, top);
  assert.equal(rec.name, top.name);
  assert.equal(rec.imageUrl, top.imageUrl);
  assert.equal(rec.soldBucket, top.soldBucket);
  assert.equal(rec.soldValue, top.soldValue);
  assert.equal(rec.negKw && typeof rec.negKw, 'object');
});
