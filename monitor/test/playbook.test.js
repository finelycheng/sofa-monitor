import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, analyzePlaybook } from '../scrape/playbookAnalyzer.js';

const product = { productId: 'p1', titleFull: 'MeeXi Sofabed Density 23 Vacuum', description: 'sofa bed minimalis',
  priceIdr: 1220000, originalPriceIdr: 1900000, discount: 36, variants: ['Abu','Biru'],
  trust: { cod: true, cicil: true, freeOngkir: false, garansi: true, shopTier: 'Power Merchant', origin: 'Bandung', shipEta: '2-3 hari' } };
const reviews = [{ rating: 5, text: 'empuk banget suka', variant: 'Abu' }, { rating: 1, text: 'kempes setelah sebulan', variant: 'Biru' }];

test('buildPrompt 含产品关键信息与评论', () => {
  const p = buildPrompt(product, reviews);
  assert.match(p, /MeeXi Sofabed Density 23/);
  assert.match(p, /kempes/);
  assert.match(p, /JSON/i);
});

test('analyzePlaybook 解析 DeepSeek JSON 返回画像卡', async () => {
  const fakeCard = { sellingPoint: '真空压缩D23', pricing: '伪折扣36%', audience: '小户型',
    differentiation: '密度进标题', effectiveness: '★★★★☆', weakness: '塌陷', snipePoint: 'D28打它', summary: '性价比打法弱在耐久' };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(fakeCard) } }] }) });
  const card = await analyzePlaybook(product, reviews, { apiKey: 'sk-test', fetchImpl });
  assert.equal(card.productId, 'p1');
  assert.equal(card.weakness, '塌陷');
  assert.equal(card.sellingPoint, '真空压缩D23');
});

test('analyzePlaybook 失败重试后返 null 不抛', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const card = await analyzePlaybook(product, reviews, { apiKey: 'sk-test', fetchImpl });
  assert.equal(card, null);
});

import { buildReviewInsightPrompt, analyzeReviewInsight } from '../scrape/playbookAnalyzer.js';

test('buildReviewInsightPrompt 含评论+要求好评差评JSON', () => {
  const p = buildReviewInsightPrompt({ titleFull: 'MeeXi Sofabed' }, [{ rating: 5, text: 'empuk banget nyaman' }, { rating: 1, text: 'kempes setelah sebulan' }]);
  assert.match(p, /empuk banget/);
  assert.match(p, /kempes/);
  assert.match(p, /praises/);
  assert.match(p, /complaints/);
  assert.match(p, /motivations/);
});

test('analyzeReviewInsight 解析评论洞察卡', async () => {
  const fake = { praises: [{ point: '坐感软empuk', count: 12 }], complaints: [{ point: '用久塌陷', count: 5 }],
    motivations: ['小户型'], truthSummary: '性价比好但耐久差', wordOfMouth: '多数满意有复购' };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(fake) } }] }) });
  const card = await analyzeReviewInsight({ productId: 'p1', titleFull: 'x' }, [{ rating: 5, text: 'a' }], { apiKey: 'sk-test', fetchImpl });
  assert.equal(card.productId, 'p1');
  assert.equal(card.praises[0].point, '坐感软empuk');
  assert.equal(card.complaints[0].count, 5);
  assert.equal(card.truthSummary, '性价比好但耐久差');
});

test('analyzeReviewInsight 失败返 null 不抛', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const card = await analyzeReviewInsight({ productId: 'p1' }, [], { apiKey: 'sk-test', fetchImpl });
  assert.equal(card, null);
});

import { translateNames } from '../scrape/playbookAnalyzer.js';

test('translateNames 批量翻译返回中文数组', async () => {
  const fake = { names: ['MeeXi真空压缩沙发床D23', 'Quantum三折沙发床20cm'] };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(fake) } }] }) });
  const cn = await translateNames(['MeeXi Sofabed Density 23 Vacuum', 'Quantum Lipat 3 Tebal 20cm'], { apiKey: 'sk-test', fetchImpl });
  assert.equal(cn.length, 2);
  assert.equal(cn[0], 'MeeXi真空压缩沙发床D23');
});

test('translateNames 空输入返 null', async () => {
  assert.equal(await translateNames([], { apiKey: 'sk-test' }), null);
});
