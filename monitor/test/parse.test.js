import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseSoldLabel, parseRatingLine } from '../lib/parse.js';

test('parsePrice 解析印尼价格格式', () => {
  assert.equal(parsePrice('Rp1.220.000'), 1220000);
  assert.equal(parsePrice('Rp95.684'), 95684);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('Gratis'), null);
});

test('parseSoldLabel 解析销量分桶', () => {
  assert.deepEqual(parseSoldLabel('2rb+ terjual'), { bucket: '2rb+', value: 2000 });
  assert.deepEqual(parseSoldLabel('10rb+ terjual'), { bucket: '10rb+', value: 10000 });
  assert.deepEqual(parseSoldLabel('Terjual 750+'), { bucket: '750+', value: 750 });
  assert.deepEqual(parseSoldLabel('Terjual 1,2jt+'), { bucket: '1,2jt+', value: 1200000 });
  assert.deepEqual(parseSoldLabel('40+ terjual'), { bucket: '40+', value: 40 });
  assert.equal(parseSoldLabel('tidak ada'), null);
});

test('parseRatingLine 解析评分与评分人数', () => {
  assert.deepEqual(parseRatingLine('4.9 (649 rating)'), { rating: 4.9, ratingCount: 649 });
  assert.deepEqual(parseRatingLine('4.7 (117 rating)'), { rating: 4.7, ratingCount: 117 });
  assert.deepEqual(parseRatingLine('3.925 rating'), null);
});
