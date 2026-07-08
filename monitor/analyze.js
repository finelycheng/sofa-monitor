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

export function buildHighlights(s, config, today) {
  const H = [];
  const th = config.thresholds;
  const push = (level, icon, text, url = '') => H.push({ level, icon, text, url });

  for (const p of config.products) {
    const pts = s.products[p.id]?.points ?? [];
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];

    // 连续缺数(红):最近 missingDays 天无点或点 ok=false
    const lastD = last?.d;
    const daysSince = lastD ? Math.round((new Date(today) - new Date(lastD)) / 86400000) : Infinity;
    if (daysSince >= th.missingDays || (last && !last.ok && prev && !prev.ok)) {
      push('red', '⚠️', `${p.label} 连续 ${Math.max(daysSince, 2)} 天无数据,疑似下架/改链接`, p.url);
      continue;
    }
    if (!last || !prev || last.d !== today) continue;

    if (last.price && prev.price) {
      const pct = ((last.price - prev.price) / prev.price) * 100;
      if (Math.abs(pct) >= th.priceChangePct)
        push('yellow', '💰', `${p.label} 价格 ${pct > 0 ? '+' : ''}${pct.toFixed(0)}%(${prev.price.toLocaleString()} → ${last.price.toLocaleString()})`, p.url);
    }
    if (last.soldBucket && prev.soldBucket && last.soldValue > prev.soldValue)
      push('yellow', '📈', `${p.label} 销量跳桶:${prev.soldBucket} → ${last.soldBucket}`, p.url);

    const wd = s.derived.products[p.id]?.ratingWeeklyDelta ?? [];
    if (wd.length >= 5) {
      const cur = wd[wd.length - 1];
      const base = wd.slice(-5, -1).reduce((a, b) => a + b, 0) / 4;
      if (base > 0 && cur > base * th.ratingCountAccel)
        push('yellow', '⭐', `${p.label} 动销加速:本周评分 +${cur}(4周均值 ${base.toFixed(1)})`, p.url);
    }
    if (last.rank && prev.rank && Math.abs(last.rank - prev.rank) >= th.rankShift)
      push('info', '📉', `${p.label} 在「${p.primaryKeyword}」排名 ${prev.rank} → ${last.rank}`, p.url);
    if (s.derived.products[p.id]?.restock)
      push('info', '📦', `${p.label} 补货:库存 ${prev.stock} → ${last.stock}(+${last.stock - prev.stock})`, p.url);

    const added = last.variants.filter((v) => !prev.variants.includes(v));
    const removed = prev.variants.filter((v) => !last.variants.includes(v));
    if (added.length || removed.length)
      push('yellow', '🎨', `${p.label} 变体变化:${added.map((v) => '+' + v).concat(removed.map((v) => '-' + v)).join(' ')}`, p.url);

    if (last.origin && prev.origin && last.origin !== prev.origin)
      push('info', '🚚', `${p.label} 发货地变更:${prev.origin} → ${last.origin}`, p.url);
  }

  // 新玩家入榜(对每个关键词,今日 Top10 中的历史新 url)
  for (const k of config.keywords) {
    const kd = s.keywords[k.key];
    if (!kd?.points?.length) continue;
    const kpts = kd.points;
    const lastP = kpts[kpts.length - 1];
    if (lastP.d !== today || kpts.length < 2) continue;
    const seenBefore = new Set(kpts.slice(0, -1).flatMap((x) => x.topUrls));
    for (const [i, u] of lastP.topUrls.entries()) {
      if (!seenBefore.has(u)) {
        const item = kd.lastTop?.find((x) => x.url === u);
        push('yellow', '🆕', `「${k.key}」新玩家进 Top${i + 1}:${item?.title?.slice(0, 40) ?? u}`, u);
      }
    }
  }

  // 汇率
  const fx = s.fx.points;
  if (fx.length >= 2) {
    const pct = ((fx[fx.length - 1].idrPerCny - fx[fx.length - 2].idrPerCny) / fx[fx.length - 2].idrPerCny) * 100;
    if (Math.abs(pct) >= th.fxChangePct)
      push('yellow', '💱', `IDR/CNY 汇率变动 ${pct > 0 ? '+' : ''}${pct.toFixed(1)}%(现 ${fx[fx.length - 1].idrPerCny})`);
  }

  // 大促窗口标注(info)
  const md = today.slice(5), day = +today.slice(8);
  for (const c of config.campaignCalendar ?? []) {
    if (c.date && c.date === md) push('info', '📅', `今日处于 ${c.label} 窗口,销量异动需结合大促解读`);
    if (c.payday && day >= 22 && day <= 28) push('info', '📅', `本周为${c.label},购买力峰值窗口`);
  }

  // 店铺上新
  for (const [id, sh] of Object.entries(s.shops ?? {})) {
    const spts = sh.points;
    if (spts.length < 2 || spts[spts.length - 1].d !== today) continue;
    const prevSet = new Set(spts[spts.length - 2].productUrls);
    for (const u of spts[spts.length - 1].productUrls)
      if (!prevSet.has(u)) push('yellow', '🏪', `店铺 ${config.shops?.find((x) => x.id === id)?.label ?? id} 上新`, u);
  }

  const order = { red: 0, yellow: 1, info: 2 };
  return H.sort((a, b) => order[a.level] - order[b.level]);
}
