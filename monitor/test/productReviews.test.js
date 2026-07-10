import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { extractReviews } from '../scrape/productReviews.js';

let browser, page;
before(async () => { browser = await chromium.launch(); page = await browser.newPage(); });
after(async () => { await browser.close(); });

test('extractReviews 从评论区取结构化评论', async () => {
  await page.setContent(readFileSync(new URL('../fixtures/product-reviews.html', import.meta.url), 'utf8'), { waitUntil: 'domcontentloaded' });
  const rv = await extractReviews(page, 50);
  assert.ok(rv.length >= 5, `got ${rv.length}`);
  assert.ok(rv.every((r) => typeof r.text === 'string'));
  assert.ok(rv.some((r) => r.text.length > 5), '至少有非空评论文本');
});
