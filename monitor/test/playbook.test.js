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
