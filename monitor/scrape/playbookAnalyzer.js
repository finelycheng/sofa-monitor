export function buildPrompt(p, reviews) {
  const rv = reviews.slice(0, 50).map((r) => `[${r.rating ?? '?'}★] ${r.text}`).join('\n');
  return `你是印尼沙发电商竞品分析师。根据以下 Tokopedia 产品信息和买家评论,提炼这个竞品的商业打法。

产品标题: ${p.titleFull}
描述: ${(p.description || '').slice(0, 800)}
价格: Rp${p.priceIdr}${p.originalPriceIdr ? ` (划线Rp${p.originalPriceIdr},折${p.discount}%)` : ''}
变体: ${(p.variants || []).join(' / ')}
信任要素: COD=${p.trust?.cod} 分期=${p.trust?.cicil} 免运=${p.trust?.freeOngkir} 保证=${p.trust?.garansi} 店铺=${p.trust?.shopTier} 发货地=${p.trust?.origin} 时效=${p.trust?.shipEta}
买家评论(最多50条):
${rv}

只输出 JSON,字段(全部中文值):
{"sellingPoint":"主打卖点(标题堆的SEO词+核心主张)","pricing":"定价打法","audience":"目标人群","differentiation":"差异化点(vs同类)","effectiveness":"效果评级(★1-5+一句依据)","weakness":"弱点(差评暴露的软肋)","snipePoint":"我方狙击点(怎么正面打它)","summary":"一句话打法总结"}`;
}

export async function analyzePlaybook(product, reviews, { apiKey, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const body = {
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: buildPrompt(product, reviews) }],
    response_format: { type: 'json_object' },
    temperature: 0.3, max_tokens: 800,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) { if (attempt === 0) continue; return null; }
      const j = await resp.json();
      const content = j?.choices?.[0]?.message?.content;
      if (!content) { if (attempt === 0) continue; return null; }
      const card = JSON.parse(content);
      return { productId: product.productId, ...card };
    } catch { if (attempt === 0) continue; return null; }
  }
  return null;
}
