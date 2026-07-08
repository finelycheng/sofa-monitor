import { parsePrice, parseSoldLabel, parseRatingLine } from '../lib/parse.js';

export async function extractProduct(page) {
  const raw = await page.evaluate(() => {
    const t = document.body.innerText;
    const g = (re) => { const m = t.match(re); return m ? m[0] : ''; };
    const priceEl = document.querySelector('[data-testid="lblPDPDetailProductPrice"]');
    const origEl = document.querySelector('[data-testid="lblPDPDetailOriginalPrice"]');
    const variants = [...document.querySelectorAll('[data-testid="pdpVariantContainer"] button, [data-testid*="Variant"] button')]
      .map((b) => b.innerText.trim()).filter(Boolean);
    const stockM = t.match(/Stok(?:\sTotal)?\s*:?\s*([\d.,]+)/i);
    const originM = t.match(/Dikirim dari\s*\n?\s*([^\n]+)/i);
    return {
      priceText: priceEl ? priceEl.innerText : g(/Rp[\d.]+/),
      originalPriceText: origEl ? origEl.innerText : '',
      soldText: g(/Terjual\s[\d.,]+\s?(?:rb|jt)?\+?/i),
      ratingLine: g(/\d\.\d\s*\([\d.,]+\s*rating\)/i),
      stockText: stockM ? stockM[1] : '',
      variants,
      origin: originM ? originM[1].trim() : '',
    };
  });
  const sold = parseSoldLabel(raw.soldText ? raw.soldText + ' terjual' : '');
  const rl = parseRatingLine(raw.ratingLine);
  const priceIdr = parsePrice(raw.priceText);
  return {
    ok: priceIdr != null,                        // 最低字段校验:价格解析不出 = 本模块 degraded
    priceIdr,
    originalPriceIdr: parsePrice(raw.originalPriceText),
    soldBucket: sold?.bucket ?? null,
    soldValue: sold?.value ?? null,
    rating: rl?.rating ?? null,
    ratingCount: rl?.ratingCount ?? null,
    stock: raw.stockText ? parseInt(raw.stockText.replace(/[.,]/g, ''), 10) : null,
    variants: raw.variants,
    origin: raw.origin,
  };
}
