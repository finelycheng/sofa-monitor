import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gap = () => 8000 + Math.floor(Math.random() * 12000); // 8-20s

export async function launch({ fast = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'id-ID',
  });
  const page = await ctx.newPage();
  let first = true;
  return {
    browser,
    page,
    /** 访问 url;返回 'ok' | 'blocked'。blocked = 熔断信号,调用方应放弃当日剩余条目 */
    async visit(url) {
      if (!first && !fast) await sleep(gap());
      first = false;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2500); // 等 JS 渲染
        if (/verify|tkpd-otp/.test(page.url())) return 'blocked';
        return 'ok';
      } catch {
        return 'error';
      }
    },
    async close() { await browser.close(); },
  };
}

/** 搜索页/店铺页通用:慢速滚动触发虚拟加载 */
export async function slowScroll(page, times = 8) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(600 + Math.floor(Math.random() * 300));
  }
}
