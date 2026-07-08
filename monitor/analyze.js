export function updateSeries(series, snap, config) {
  const s = structuredClone(series ?? { products: {}, keywords: {}, fx: { points: [] }, reviews: {} });
  const d = snap.date;

  for (const p of config.products) {
    const cur = snap.products[p.id];
    if (!cur) continue;
    s.products[p.id] ??= { points: [] };
    const pts = s.products[p.id].points;
    if (pts.length && pts[pts.length - 1].d === d) continue; // 幂等
    const rank = Object.fromEntries(
      Object.entries(snap.keywords).map(([k, items]) => [k, items.find((i) => i.url === p.url)?.rank ?? null])
    );
    pts.push({
      d, price: cur.priceIdr, origPrice: cur.originalPriceIdr, soldBucket: cur.soldBucket,
      soldValue: cur.soldValue, rating: cur.rating, ratingCount: cur.ratingCount,
      stock: cur.stock, variantCount: cur.variants?.length ?? null, variants: cur.variants ?? [],
      origin: cur.origin, rank: rank[p.primaryKeyword] ?? null, ok: cur.ok !== false,
    });
  }

  for (const k of config.keywords) {
    const items = snap.keywords[k.key];
    if (!items) continue;
    s.keywords[k.key] ??= { points: [], lastTop: [] };
    const kpts = s.keywords[k.key].points;
    if (!(kpts.length && kpts[kpts.length - 1].d === d)) {
      const prices = items.map((i) => i.priceIdr).filter((n) => n > 0).sort((a, b) => a - b);
      kpts.push({
        d,
        medianPrice: prices.length ? prices[Math.floor(prices.length / 2)] : null,
        minPrice: prices[0] ?? null,
        topUrls: items.slice(0, 10).map((i) => i.url),
      });
      s.keywords[k.key].lastTop = items;
    }
  }

  if (snap.fx?.idrPerCny && !(s.fx.points.length && s.fx.points[s.fx.points.length - 1].d === d)) {
    s.fx.points.push({ d, idrPerCny: snap.fx.idrPerCny });
  }
  if (snap.shops) {
    s.shops ??= {};
    for (const [id, v] of Object.entries(snap.shops)) {
      s.shops[id] ??= { points: [] };
      const spts = s.shops[id].points;
      if (!(spts.length && spts[spts.length - 1].d === d)) spts.push({ d, productUrls: v.productUrls });
    }
  }

  s.derived = derive(s, config);
  return s;
}

function derive(s, config) {
  const products = {};
  for (const p of config.products) {
    const pts = s.products[p.id]?.points ?? [];
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    let dailySales = null, restock = false;
    if (p.trackStock && last?.stock != null && prev?.stock != null) {
      const delta = prev.stock - last.stock;
      if (delta >= 0) dailySales = delta;
      else if (-delta >= (config.thresholds.restockMin ?? 20)) { restock = true; dailySales = null; }
      else dailySales = 0; // 小幅上调视为噪声
    }
    const discountPct = last?.origPrice && last?.price
      ? Math.round(((last.origPrice - last.price) / last.origPrice) * 100) : null;
    // 周评分增量序列(每 7 点一组,供加速规则与 dashboard)
    const rc = pts.map((x) => x.ratingCount).filter((n) => n != null);
    const ratingWeeklyDelta = [];
    for (let i = rc.length - 1; i - 7 >= 0; i -= 7) ratingWeeklyDelta.unshift(rc[i] - rc[i - 7]);
    products[p.id] = { dailySales, restock, discountPct, ratingWeeklyDelta };
  }
  const keywords = {};
  for (const k of config.keywords) {
    const kp = s.keywords[k.key]?.points ?? [];
    const last = kp[kp.length - 1];
    keywords[k.key] = { medianPrice: last?.medianPrice ?? null, minPrice: last?.minPrice ?? null };
  }
  return { products, keywords };
}

export function buildHighlights() { return []; } // Task 7 实现
