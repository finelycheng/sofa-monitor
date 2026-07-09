import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gap = () => 8000 + Math.floor(Math.random() * 12000); // 8-20s

const headed = process.env.MONITOR_HEADED === '1';

// 低内存主机(1G VPS)必备:不加 --disable-dev-shm-usage 时 chromium 用 /dev/shm,
// 连续多页导航后耗尽小 shm 导致卡死+内存泄漏,曾拖垮 1核1G 机器到 SSH 失联。
// 实测加这三项后单页稳定 ~16s。
//
// OOM 修复(2026-07-09,exit=137):Tokopedia 页面含大量第三方 iframe/tracker,
// 默认 site-per-process 会为每个站点起独立 renderer 进程,单进程 RSS 就到 ~527MB,
// 多进程叠加 + node + Xvfb 超过 961Mi+768M swap 被 OOM killer 杀掉 chrome。
// 关掉进程隔离 + 限制 renderer 数 + 封顶 JS 堆,把整个 chrome 家族压到单 renderer,
// 实测单浏览器整轮 29 次导航系统占用稳定在 ~700MB(961Mi+1.2G swap 内),不 OOM。
// 这些是纯内存/进程模型开关,不改渲染结果,不影响过 Akamai。
const HARDEN_ARGS = [
  '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
  '--disable-features=site-per-process,IsolateOrigins',
  '--renderer-process-limit=1',
  '--js-flags=--max-old-space-size=384',
];

const LAUNCH_OPTS = headed
  ? { headless: false, args: HARDEN_ARGS }
  : { headless: true, args: HARDEN_ARGS };
const CONTEXT_OPTS = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'id-ID',
};

export async function launch({ fast = false } = {}) {
  // 单浏览器全程复用(整只浏览器重启会导致旧 chrome 进程树未回收就叠新的,曾把 1核1G 机器
  // 直接压垮到全网失联)。改为:每次 visit 用全新 context+page,关掉上一页。
  //
  // 为什么必须换页而不是复用同一 page 连续 goto:同一 page 跳到第 2 个"重页面"(搜索页满是
  // 商品卡+第三方 tracker/无限滚动 observer)时,上一页残留的 JS/定时器会拖住新页,slowScroll 的
  // page.evaluate 挂死 60s 超时(实测 reuse 模式 nav1 成功 nav2/3 必挂)。全新 context 既清掉
  // 上一页渲染内存,又切断跨页 JS 干扰,单页在场保证内存只占一页之量。
  const browser = await chromium.launch(LAUNCH_OPTS);
  let ctx = null;
  let page = null;
  let first = true;
  async function closeCtx() {
    if (ctx) { try { await ctx.close(); } catch {} ctx = null; page = null; }
  }
  async function openCtx() {
    ctx = await browser.newContext(CONTEXT_OPTS);
    page = await ctx.newPage();
  }
  return {
    get browser() { return browser; },
    get page() { return page; }, // getter:换页后 page 被替换,调用方(run.js 用 b.page)须拿当前实例
    /** 访问 url;返回 'ok' | 'blocked'。blocked = 熔断信号,调用方应放弃当日剩余条目 */
    async visit(url) {
      // 先关掉上一条目的 ctx 再 gap-sleep:上一页若因 withTimeout 超时而挂起(evaluate 仍在
      // 后台跑),旧写法把 close 放在 sleep 之后,挂起页会在整个 8-20s 等待期内和(稍后开的)
      // 新页同时占内存。提前到 sleep 之前关闭,把这段双开窗口收窄到 0。
      await closeCtx();
      if (!first && !fast) await sleep(gap());
      first = false;
      await openCtx(); // 每次访问全新 context+page(fast 模式也换,开销 ~100ms,换来干净页)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2500); // 等 JS 渲染
        if (/verify|tkpd-otp/.test(page.url())) return 'blocked';
        return 'ok';
      } catch {
        return 'error';
      }
    },
    async close() { try { await browser.close(); } catch {} },
  };
}

/** 搜索页/店铺页通用:慢速滚动触发虚拟加载 */
export async function slowScroll(page, times = 8) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(600 + Math.floor(Math.random() * 300));
  }
}

/**
 * 硬超时包装:页面崩溃/无响应时 page.evaluate 会永久挂起(实测 1核VPS 上某页崩溃
 * 导致整轮 daily 卡死 2 小时不产快照)。用它包住 slowScroll/extract 等页面操作,
 * 超时抛错被调用方 catch 捕获记为 error 并跳过该条目,保证整轮必然收敛。
 */
export function withTimeout(promise, ms, label = 'op') {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
