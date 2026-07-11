// DeepSeek 通用调用:JSON mode + 重试1次,失败返 null 不抛
async function callDeepSeek(prompt, { apiKey, fetchImpl = fetch, timeoutMs = 30000, maxTokens = 800 } = {}) {
  const body = {
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3, max_tokens: maxTokens,
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
      return JSON.parse(content);
    } catch { if (attempt === 0) continue; return null; }
  }
  return null;
}

// ── 商业打法卡(卖点/定价/人群/差异化/效果/弱点/狙击点) ──
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

export async function analyzePlaybook(product, reviews, opts = {}) {
  const card = await callDeepSeek(buildPrompt(product, reviews), opts);
  return card ? { productId: product.productId, ...card } : null;
}

// ── 用户评论洞察卡(好评/差评/购买动机/真实反馈/口碑) ──
export function buildReviewInsightPrompt(p, reviews) {
  const rv = reviews.slice(0, 50).map((r) => `[${r.rating ?? '?'}★] ${r.text}`).join('\n');
  return `你是印尼沙发买家研究员。仔细读以下某沙发产品的 Tokopedia 买家评论,提炼用户对这个沙发的真实反馈——他们夸什么、骂什么、为什么买。

产品: ${p.titleFull || p.name}
买家评论(最多50条,格式 [星级] 内容):
${rv}

只输出 JSON,字段全部中文值。praises/complaints 按提及频次从高到低排序,count 是大致提及条数(整数):
{"praises":[{"point":"用户夸的具体点(如 坐感软/性价比高/物流快)","count":数字}],"complaints":[{"point":"用户骂的具体点(如 用久塌陷/面料薄/色差)","count":数字}],"motivations":["购买动机(如 送父母/小户型/换旧沙发)"],"truthSummary":"一段话讲透这沙发的真实体验:好在哪、坑在哪、什么人买了最满意、什么人最后悔","wordOfMouth":"口碑总结:整体评价倾向 + 有无复购/推荐提及"}`;
}

export async function analyzeReviewInsight(product, reviews, opts = {}) {
  const card = await callDeepSeek(buildReviewInsightPrompt(product, reviews), { maxTokens: 1000, ...opts });
  return card ? { productId: product.productId, ...card } : null;
}

// ── 批量把印尼语产品名翻译成简洁中文(一次调用翻一店 top20)──
export async function translateNames(names, opts = {}) {
  if (!names || !names.length) return null;
  const prompt = `把以下印尼语沙发产品名翻译成简洁中文,每个≤18字,保留型号/尺寸/材质/关键卖点(如 真空压缩/2in1/密度D23)。只输出 JSON,names 数组顺序与输入一一对应:
${names.map((n, i) => `${i}. ${n}`).join('\n')}
输出格式: {"names":["中文名0","中文名1", ...]}`;
  const r = await callDeepSeek(prompt, { maxTokens: 1500, ...opts });
  return Array.isArray(r?.names) ? r.names : null;
}
