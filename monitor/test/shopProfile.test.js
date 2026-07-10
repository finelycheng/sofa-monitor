import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { extractShopTop, extractProductProfile } from '../scrape/shopProfile.js';

let browser, page;
before(async () => { browser = await chromium.launch(); page = await browser.newPage(); });
after(async () => { await browser.close(); });
const load = (n) => page.setContent(readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8'), { waitUntil: 'domcontentloaded' });

test('extractShopTop 取销量排序前N有销量产品', async () => {
  await load('shop-sorted.html');
  const items = await extractShopTop(page, 20);
  assert.ok(items.length >= 5 && items.length <= 20, `got ${items.length}`);
  assert.equal(items[0].rank, 1);
  assert.match(items[0].url, /tokopedia\.com/);
  assert.ok(items[0].name.length > 0);
  assert.ok(items.every((i) => i.soldValue > 0), '全部须有销量');
});

test('extractProductProfile 取六维度原始字段', async () => {
  await load('product-reviews.html');
  const p = await extractProductProfile(page);
  assert.equal(p.ok, true);
  assert.ok(p.titleFull.length > 10);
  assert.ok(Array.isArray(p.mainImages));
  assert.ok(Array.isArray(p.variants));
  assert.equal(typeof p.trust, 'object');
});
