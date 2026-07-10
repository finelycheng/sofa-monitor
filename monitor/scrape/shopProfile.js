import { parsePrice, parseSoldLabel, parseRatingLine } from '../lib/parse.js';

// 店铺销量排序:Tokopedia 店铺页 /<shop>/product?sort=8(销量降序)
// fixture(shop-sorted.html)实测:卡片结构与 keyword/shop 抓取一致,复用同一启发式即可取到 8 个降序产品(2rb+ → 30+)
export async function extractShopTop(page, topN = 20) {
  const raw = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('a[href*="tokopedia.com"]')]
      .filter((a) => a.querySelector('img') && /Rp/.test(a.innerText));
    const seen = new Set(); const out = [];
    for (const a of cards) {
      const url = a.href.split('?')[0];
      const path = new URL(url).pathname.split('/').filter(Boolean);
      if (path.length !== 2 || seen.has(url)) continue;
      seen.add(url);
      const L = a.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      out.push({ url, name: L.find((x) => !/^Rp|terjual|%|★|\d\.\d$/i.test(x)) || L[0] || '',
        img: a.querySelector('img')?.src || '',
        soldText: L.find((x) => /terjual/i.test(x)) || '' });
    }
    return out;
  });
  const withSold = raw
    .map((r) => ({ ...r, sold: parseSoldLabel(r.soldText) }))
    .filter((r) => r.sold && r.sold.value > 0);
  return withSold.slice(0, topN).map((r, i) => ({
    rank: i + 1,
    productId: r.url.split('-').pop().replace(/[^\d]/g, '') || r.url.split('/').pop(),
    name: r.name, url: r.url, imageUrl: r.img,
    soldBucket: r.sold.bucket, soldValue: r.sold.value,
  }));
}

export async function extractProductProfile(page) {
  const raw = await page.evaluate(() => {
    // 只在主商品自身文字范围内找信任标识,"Lainnya di toko ini"/"Pilihan lainnya untukmu" 之后是同店其他货/跨店推荐卡片,
    // 会把别的商品的"Garansi""COD"字样混进来(fixture 实测:Garansi 只出现在该锚点之后的推荐卡片文案里),故在此截断
    const full = document.body.innerText;
    const cutIdx = full.indexOf('Lainnya di toko ini');
    const t = cutIdx > -1 ? full.slice(0, cutIdx) : full;
    const g = (re) => { const m = t.match(re); return m ? m[0] : ''; };
    const title = document.querySelector('h1[data-testid="lblPDPDetailProductName"]')?.innerText
      || document.querySelector('h1')?.innerText || '';
    const priceEl = document.querySelector('[data-testid="lblPDPDetailProductPrice"]');
    const origEl = document.querySelector('[data-testid="lblPDPDetailOriginalPrice"]');
    const desc = document.querySelector('[data-testid="lblPDPDescriptionProduk"]')?.innerText || '';
    // fixture 实测:PDPImageThumbnail 内的 <img> 是懒加载占位 data: URI(未触发加载),
    // 真正主图 URL 挂在 alt 以 "Gambar " 开头的兄弟 <img> 上(Tokopedia 无障碍替代文本),故改用该选择器
    const imgs = [...document.querySelectorAll('img[alt^="Gambar"]')]
      .map((i) => i.src).filter((s) => s && s.startsWith('http'));
    const uniqImgs = [...new Set(imgs)].slice(0, 6);
    const variants = [...document.querySelectorAll('[data-testid="pdpVariantContainer"] button, [data-testid*="Variant"] button')]
      .map((b) => b.innerText.trim()).filter(Boolean);
    const originM = t.match(/Dikirim dari\s*\n?\s*([^\n]+)/i);
    return {
      titleFull: title,
      description: desc.slice(0, 2000),
      mainImages: uniqImgs,
      priceText: priceEl ? priceEl.innerText : g(/Rp[\d.]+/),
      originalPriceText: origEl ? origEl.innerText : '',
      soldText: g(/Terjual\s[\d.,]+\s?(?:rb|jt)?\+?/i),
      ratingLine: g(/\d\.\d\s*\([\d.,]+\s*rating\)/i),
      variants,
      trust: {
        cod: /\bCOD\b|Bayar di Tempat/i.test(t),
        cicil: /Cicilan|Cicil 0%|GoPayLater/i.test(t),
        freeOngkir: /Bebas Ongkir|Gratis Ongkir|Bebas ongkir/i.test(t),
        garansi: /Garansi/i.test(t),
        shopTier: /Power Merchant Pro|Power Merchant|Official Store|Mall/i.exec(t)?.[0] || '',
        origin: originM ? originM[1].trim() : '',
        shipEta: (t.match(/Estimasi tiba[^\n]*/i) || [''])[0].slice(0, 60),
      },
    };
  });
  const priceIdr = parsePrice(raw.priceText);
  const origIdr = parsePrice(raw.originalPriceText);
  const sold = parseSoldLabel(raw.soldText ? raw.soldText + ' terjual' : '');
  const rl = parseRatingLine(raw.ratingLine);
  return {
    ok: priceIdr != null,
    titleFull: raw.titleFull, description: raw.description, mainImages: raw.mainImages,
    priceIdr, originalPriceIdr: origIdr,
    discount: origIdr && priceIdr ? Math.round((origIdr - priceIdr) / origIdr * 100) : null,
    soldBucket: sold?.bucket ?? null, soldValue: sold?.value ?? null,
    rating: rl?.rating ?? null, ratingCount: rl?.ratingCount ?? null,
    variants: raw.variants, trust: raw.trust,
  };
}
