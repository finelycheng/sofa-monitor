export async function extractShop(page) {
  const productUrls = await page.evaluate(() => {
    const set = new Set();
    for (const a of document.querySelectorAll('a[href^="https://www.tokopedia.com/"]')) {
      const u = a.href.split('?')[0];
      // 店铺页商品链接形如 /<shop>/<slug>;排除店铺首页/评论页等
      const path = new URL(u).pathname.split('/').filter(Boolean);
      if (path.length === 2 && a.querySelector('img') && /Rp/.test(a.innerText)) set.add(u);
    }
    return [...set];
  });
  return { productUrls };
}
