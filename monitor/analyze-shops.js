// monitor/analyze-shops.js
export function updateShopSeries(series, snap) {
  const s = structuredClone(series ?? {});
  s[snap.shop] ??= { shopName: snap.shopName, snapshots: [] };
  const arr = s[snap.shop].snapshots;
  if (arr.length && arr[arr.length - 1].date === snap.date) return s; // 幂等
  arr.push({ date: snap.date, products: snap.products });
  if (arr.length > 90) arr.shift(); // 只留90天
  return s;
}

export function shopHighlights(series, shopId, today) {
  const H = [];
  const sh = series[shopId];
  if (!sh || sh.snapshots.length < 1) return H;
  const cur = sh.snapshots[sh.snapshots.length - 1];
  if (cur.date !== today) return H;
  const prev = sh.snapshots[sh.snapshots.length - 2];
  const push = (level, icon, text, url = '') => H.push({ level, icon, text, url });
  const byId = (list) => Object.fromEntries(list.map((p) => [p.productId, p]));
  const curM = byId(cur.products);
  if (!prev) { push('info', '🆕', `${sh.shopName} 首次画像:${cur.products.length} 个产品`); return H; }
  const prevM = byId(prev.products);
  for (const p of cur.products) {
    if (!prevM[p.productId]) push('yellow', '✨', `${sh.shopName} 上新进榜:${p.name}`, p.url);
    else {
      const q = prevM[p.productId];
      if (p.soldValue > q.soldValue && p.soldBucket !== q.soldBucket)
        push('yellow', '📈', `${sh.shopName}「${p.name}」销量跳桶 ${q.soldBucket}→${p.soldBucket}`, p.url);
      if (p.ratingCount && q.ratingCount && p.ratingCount - q.ratingCount > 20)
        push('info', '⭐', `${sh.shopName}「${p.name}」评分数 +${p.ratingCount - q.ratingCount}(动销快)`, p.url);
      const negUp = Object.entries(p.negKw || {}).filter(([k, v]) => v > (q.negKw?.[k] || 0));
      if (negUp.length) push('info', '🗣️', `${sh.shopName}「${p.name}」差评词增长:${negUp.map(([k]) => k).join(',')}`, p.url);
    }
  }
  for (const q of prev.products) if (!curM[q.productId]) push('yellow', '📉', `${sh.shopName} 掉榜/疑似下架:${q.name}`, q.url);
  const order = { red: 0, yellow: 1, info: 2 };
  return H.sort((a, b) => order[a.level] - order[b.level]);
}
