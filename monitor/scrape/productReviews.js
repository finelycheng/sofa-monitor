// monitor/scrape/productReviews.js — 从产品评论区取最近 max 条结构化评论(评分/正文/变体/时间)
export async function extractReviews(page, max = 50) {
  return await page.evaluate((limit) => {
    const out = [];
    for (const art of document.querySelectorAll('article')) {
      const txt = art.innerText || '';
      if (!/lalu/.test(txt) || txt.length < 20 || txt.length > 1500) continue;
      const lines = txt.split('\n').map((s) => s.trim()).filter(Boolean);
      const timeAgo = lines.find((l) => /lalu$/.test(l)) || '';
      const variant = (lines.find((l) => /^Varian:/.test(l)) || '').replace('Varian:', '').trim();
      const starEl = art.querySelector('[data-testid="icnStarRating"], [aria-label*="bintang"]');
      const starMatch = starEl && /bintang\s*(\d+)/.exec(starEl.getAttribute('aria-label') || '');
      const rating = starMatch ? Number(starMatch[1]) : null;
      // 评论正文:去掉时间/变体/帮助点赞/回复等模板行,取最长的一段自然语言
      const body = lines.filter((l) => !/lalu$|^Varian:|orang terbantu|Balasan|Membantu|^\d+$/.test(l))
        .sort((a, b) => b.length - a.length)[0] || '';
      out.push({ rating, text: body, variant, timeAgo });
      if (out.length >= limit) break;
    }
    return out;
  }, max);
}
