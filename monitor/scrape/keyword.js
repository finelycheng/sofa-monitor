import { parsePrice, parseSoldLabel } from '../lib/parse.js';

export async function extractKeyword(page, topN = 20) {
  const raw = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('a[href*="tokopedia.com"]')]
      .filter((a) => a.querySelector('img') && /Rp/.test(a.innerText));
    const seen = new Set(); const out = [];
    for (const a of cards) {
      const url = a.href.split('?')[0];
      if (seen.has(url)) continue; seen.add(url);
      const L = a.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      out.push({
        url,
        lines: L,
        priceText: L.find((l) => /^Rp[\d.]+$/.test(l)) || '',
        soldText: L.find((l) => /terjual/i.test(l)) || '',
        ratingText: L.find((l) => /^\d\.\d$/.test(l)) || '',
      });
    }
    return out;
  });
  return raw.slice(0, topN).map((r, i) => {
    const sold = parseSoldLabel(r.soldText);
    // 卡片文本尾部两行通常是 店名、城市(fixture 测试保证该启发式仍成立)
    const tail = r.lines.filter((l) => l !== r.priceText && l !== r.soldText);
    // 标题前可能叠加多个短徽标行(折扣百分比 "35%"、"PreOrder"/"COD" 等预售/包邮标签),
    // 逐行跳过徽标取第一条足够长且非价格/销量/评分的行作为标题(fixture 实测:纯 /%$/ 判断漏掉了 PreOrder 徽标行)
    const isBadgeLine = (l) => /^\d+%$/.test(l) || /^(PreOrder|COD)$/i.test(l);
    const title = r.lines.find((l) =>
      !isBadgeLine(l) &&
      l !== r.priceText &&
      l.length >= 10 &&
      !/^Rp[\d.]+$/.test(l) &&
      !/terjual/i.test(l) &&
      !/^\d\.\d$/.test(l)
    ) || r.lines[0] || '';
    return {
      rank: i + 1,
      url: r.url,
      title,
      priceIdr: parsePrice(r.priceText),
      soldBucket: sold?.bucket ?? null,
      soldValue: sold?.value ?? null,
      rating: r.ratingText ? parseFloat(r.ratingText) : null,
      shopName: tail[tail.length - 2] || '',
      city: tail[tail.length - 1] || '',
    };
  });
}
