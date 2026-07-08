import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { extractKeyword } from '../scrape/keyword.js';
import { extractProduct } from '../scrape/product.js';
import { extractShop } from '../scrape/shop.js';

let browser, page;
before(async () => { browser = await chromium.launch(); page = await browser.newPage(); });
after(async () => { await browser.close(); });

const load = (name) =>
  page.setContent(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'), { waitUntil: 'domcontentloaded' });

test('extractKeyword 从搜索页取出带价格的榜单', async () => {
  await load('search.html');
  const items = await extractKeyword(page, 20);
  assert.ok(items.length >= 10, `got ${items.length}`);
  assert.equal(items[0].rank, 1);
  assert.match(items[0].url, /tokopedia\.com/);
  assert.ok(items[0].priceIdr > 10000);
  assert.ok(items.every((i) => typeof i.title === 'string' && i.title.length > 0));
});

test('extractProduct 从商品页取出核心字段', async () => {
  await load('product.html');
  const p = await extractProduct(page);
  assert.equal(p.ok, true);
  assert.ok(p.priceIdr > 100000);
  assert.ok(p.ratingCount > 0);
  assert.ok(Array.isArray(p.variants));
});

test('extractShop 取出店铺商品链接集合', async () => {
  await load('shop.html');
  const s = await extractShop(page);
  assert.ok(s.productUrls.length >= 5, `got ${s.productUrls.length}`);
  assert.ok(s.productUrls.every((u) => u.startsWith('https://www.tokopedia.com/')));
});
