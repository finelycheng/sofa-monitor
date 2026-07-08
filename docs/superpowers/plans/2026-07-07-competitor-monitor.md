# 竞品监控系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tokopedia 竞品每日无人值守监控:抓取→差分→高亮→静态 dashboard 发布到 sofa.wefishing.cn。

**Architecture:** Node + Playwright 抓取脚本跑在服务器 Docker 容器(官方 playwright 镜像,bind-mount 代码,不自建镜像),宿主 cron 触发;数据为只追加 JSON 快照 + 滚动 series;dashboard 是纯静态 HTML,fetch JSON 渲染。设计文档:`docs/superpowers/specs/2026-07-07-competitor-monitor-design.md`。

**Tech Stack:** Node 20(容器自带)、Playwright(版本必须与容器 tag 一致)、node:test(零依赖测试)、Docker(服务器 CentOS 7)、nginx 静态发布。

## Global Constraints

- Playwright 版本与容器镜像 tag 严格一致:`package.json` 用 `"playwright": "1.49.0"`,容器用 `mcr.microsoft.com/playwright:v1.49.0-jammy`
- 抓取节奏:页间随机 8-20 秒,禁止并发;遇 `verify`/`tkpd-otp` URL 立即放弃当日剩余条目并在快照标记,绝不重试轰炸
- 数据只追加:`data/snapshots/YYYY-MM-DD.json` 永不改写;`series.json` 更新前先写 `.bak`
- 渲染/发布失败不得覆盖线上旧文件(宁可停更,不可白屏)
- 服务器路径:代码+数据 `/home/monitor`,发布目标 `/usr/share/nginx/html`;nginx 改配置前 `cp sofa.conf sofa.conf.bak.$(date +%Y%m%d%H%M%S)`,`nginx -t` 通过才 reload
- 所有新文件在 `/Users/czq/sofa/monitor/` 内;本地是源码 home,服务器只有运行时和数据
- 语言:代码注释和 dashboard 文案用中文;数据字段名用英文

## File Structure

```
monitor/
├── package.json                # playwright 1.49.0;scripts: test/daily/weekly
├── monitor.config.json         # 关键词/竞品/店铺/阈值/负面词/大促日历
├── run.js                      # CLI: node run.js daily|weekly [--dry-run]
├── lib/
│   ├── parse.js                # 纯函数:parsePrice/parseSoldLabel/parseRatingLine
│   ├── browser.js              # 浏览器实例、慢速节奏、防爬熔断
│   └── io.js                   # 快照读写、series 读写(.bak)、日志
├── scrape/
│   ├── keyword.js              # 搜索页 TopN
│   ├── product.js              # 商品页字段
│   ├── shop.js                 # 店铺页商品 url 集合
│   ├── fx.js                   # IDR/CNY 汇率
│   └── reviews.js              # weekly 低星扫描
├── analyze.js                  # 纯函数:updateSeries + buildHighlights
├── dashboard/competitor-monitor.html   # 静态页(fetch monitor_data/*.json)
├── deploy/
│   ├── run-daily.sh            # 宿主 wrapper:docker run + 发布 + 失败标记
│   ├── run-weekly.sh
│   └── crontab.txt             # 文档化 cron 行
├── tools/capture-fixtures.js   # 本地抓真实页面存 fixtures
├── fixtures/                   # search.html / product.html / shop.html / fx.json
└── test/
    ├── parse.test.js           # node:test 纯函数
    ├── extract.test.js         # playwright setContent + fixtures 测 DOM 提取
    └── analyze.test.js         # 两日假快照测差分/规则
```

---

### Task 1: 项目脚手架 + git init + 配置文件

**Files:**
- Create: `monitor/package.json`, `monitor/monitor.config.json`, `monitor/.gitignore`, `/Users/czq/sofa/.gitignore`

**Interfaces:**
- Produces: `monitor.config.json` 的 schema(后续所有任务读它);npm scripts `test`

- [ ] **Step 1: git init(仓库尚不存在)**

```bash
cd /Users/czq/sofa && git init -b main
printf 'node_modules/\n.DS_Store\n.playwright-mcp/\nmonitor/data/\nmonitor/out/\n' > .gitignore
git add .gitignore docs/ && git commit -m "chore: init repo with specs"
```

- [ ] **Step 2: 写 package.json**

```json
{
  "name": "sofa-competitor-monitor",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "daily": "node run.js daily",
    "weekly": "node run.js weekly"
  },
  "dependencies": { "playwright": "1.49.0" }
}
```

- [ ] **Step 3: 写 monitor.config.json(真实初始清单,来自选品作战板对标关系)**

```json
{
  "keywords": [
    {"key": "sofa bed minimalis", "topN": 20},
    {"key": "sofa tanpa tulang", "topN": 20},
    {"key": "kursi sholat", "topN": 20},
    {"key": "kursi lantai lipat", "topN": 20},
    {"key": "sajadah busa tebal", "topN": 20},
    {"key": "sofa L minimalis", "topN": 20}
  ],
  "products": [
    {"id": "nusahome-vac", "label": "NusaHome 压缩沙发", "primaryKeyword": "sofa bed minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/nusahome-sofa-kasur/cod-nusahome-sofa-kepadatan-kain-nyaman-mewah-lembut-keriting-anti-kotor-tahan-kompresi-dapat-dicuci-tahan-aus-furnitur-sederhana-sandaran-ruang-tamu-sofa-malas-lembut-baru-2025-minimalis-1734250936601708470"},
    {"id": "meexi-d23-a", "label": "MeeXi D23 压缩(主链)", "primaryKeyword": "sofa bed minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/meexistore/meexi-sofabed-density-23-sofa-bed-minimalis-sofa-tidur-sofa-kasur-sofa-vacuum-compressible-boneless-couch-sofa-kecil-untuk-kamar-sofa-untuk-ruang-tamu-sempit-tapi-mewah-kasur-sofa-1732127420746466525"},
    {"id": "meexi-d23-b", "label": "MeeXi D23 压缩(副链)", "primaryKeyword": "sofa bed minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/meexistore/meexi-sofabed-density-23-sofa-bed-minimalis-sofa-tidur-sofa-kasur-sofa-vacuum-compressible-boneless-couch-sofa-kecil-untuk-kamar-sofa-untuk-ruang-tamu-sempit-tapi-mewah-kasur-sofa-1732225212112274653"},
    {"id": "inthebox-100", "label": "INTHEBOX 三折 100x200", "primaryKeyword": "sofa bed minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/intheboxid/inthebox-sofabed-ukuran-100x200-100x200"},
    {"id": "quantum-lipat3", "label": "Quantum 三折 20cm", "primaryKeyword": "sofa bed minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/quantumspringbed/sofa-bed-kasur-quantum-lipat-3-tebal-20cm-sofabed-minimalis-nyaman-1729857039579450260"},
    {"id": "turu-2in1", "label": "TURU 2in1 120x190", "primaryKeyword": "sofa bed minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/turubed/turu-sofa-bed-2in1-uk-120x190-turu-minimalis-grey-trifold-kasur-sofa-1729857035885813012"},
    {"id": "meedo-fuji", "label": "Mee-DO FUJI 地板沙发", "primaryKeyword": "kursi lantai lipat", "trackStock": true,
     "url": "https://www.tokopedia.com/expertmattress/mee-do-sofa-bed-kursi-lantai-lipat-lesehan-malas-fuji-cream-63b70"},
    {"id": "furla-kursi", "label": "furlaindah 海绵垫礼拜椅", "primaryKeyword": "kursi sholat", "trackStock": true,
     "url": "https://www.tokopedia.com/furlaindah/kursi-lipat-kursi-teras-kursi-sholat-motif-bulat-hitam-merah-import-hitam-busa-7de41"},
    {"id": "puja-silver", "label": "PUJA 高端礼拜椅 Silver", "primaryKeyword": "kursi sholat", "trackStock": true,
     "url": "https://www.tokopedia.com/pujakursi/kursi-sholat-sujud-hitam"},
    {"id": "mutiara-sajadah", "label": "mutiara 5cm 加厚礼拜毯", "primaryKeyword": "sajadah busa tebal", "trackStock": true,
     "url": "https://www.tokopedia.com/mutiara-home/sajadah-muslim-polos-tebal-bulu-rasfur-lembut-nyaman-busa-royal-foam-uk-110x65x5-motif-kabah-bordir-hitam-hampers-turki-1729546963067898015"},
    {"id": "nala-sofaL", "label": "Nala Argani L型+Pouf", "primaryKeyword": "sofa L minimalis", "trackStock": false,
     "url": "https://www.tokopedia.com/nala-argani/sofa-l-sofa-minimalis"},
    {"id": "zfurn-sofaL", "label": "Z furniture L型", "primaryKeyword": "sofa L minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/zfurnituretermurah/sofa-sofa-l-sofa-modern-sofa-minimalis-sofabed-sofa-ruang-tamu-sofa-mewah-sofa-l-minimalis-sofa-l-putus-busa-kayu-furniture-set-asli-1731507818133620151"},
    {"id": "yonezawa-usb", "label": "yonezawa USB 矮桌", "primaryKeyword": "kursi lantai lipat", "trackStock": true,
     "url": "https://www.tokopedia.com/yonezawa/yonezawa-cod-meja-lipat-laptop-belajar-foldable-bed-table-adjustable-serbaguna-with-usb-port-meja-portable-1732122243847849185"},
    {"id": "gotozila", "label": "Goto Zila 高端地板椅", "primaryKeyword": "kursi lantai lipat", "trackStock": true,
     "url": "https://www.tokopedia.com/gotoliving/goto-zila-folding-lazy-chair-kursi-lipat-tidur-santai-malas-portable-1729841977094620500"},
    {"id": "tete-sofabed", "label": "TETE 沙发床", "primaryKeyword": "sofa bed minimalis", "trackStock": true,
     "url": "https://www.tokopedia.com/tete-furniture-store/tete-1-sofa-bed-2-seater-nyaman-kuat-ruang-tamu-minimalis-modern-elegan-sofa-tidur-untuk-ruang-tamu-kecil-apartemen-sofa-2-duduk-kuat-nyaman-sofa-modern-ruang-tamu-sofa-tidur-untuk-kamar-tidur-kecil-sofa-bed-2seater-untuk-rumah-minimalis-orange145-65-70cm-1732663300127753549"}
  ],
  "shops": [
    {"id": "meexistore", "label": "MeeXi", "url": "https://www.tokopedia.com/meexistore"},
    {"id": "nusahome", "label": "NusaHome", "url": "https://www.tokopedia.com/nusahome-sofa-kasur"},
    {"id": "inthebox", "label": "INTHEBOX", "url": "https://www.tokopedia.com/intheboxid"},
    {"id": "quantum", "label": "Quantum Springbed", "url": "https://www.tokopedia.com/quantumspringbed"},
    {"id": "turu", "label": "TURU", "url": "https://www.tokopedia.com/turubed"},
    {"id": "furlaindah", "label": "Furla Indah", "url": "https://www.tokopedia.com/furlaindah"},
    {"id": "pujakursi", "label": "PUJA", "url": "https://www.tokopedia.com/pujakursi"},
    {"id": "expertmattress", "label": "Expert Mattress(Mee-DO)", "url": "https://www.tokopedia.com/expertmattress"}
  ],
  "thresholds": {
    "priceChangePct": 5, "rankShift": 5, "ratingCountAccel": 1.5,
    "fxChangePct": 3, "missingDays": 2, "restockMin": 20
  },
  "negativeKeywords": ["sobek", "kempes", "tidak mengembang", "lama", "beda warna", "tidak sesuai"],
  "campaignCalendar": [
    {"date": "07-07", "label": "Tokopedia 7.7 大促"},
    {"date": "09-09", "label": "9.9 大促"},
    {"date": "11-11", "label": "11.11 大促"},
    {"date": "12-12", "label": "12.12 大促"},
    {"payday": true, "label": "发薪周(每月25日±3天)"}
  ]
}
```

注意:`turu-2in1` 与 `gotozila` 的 URL 若 404(是从历史快照复原的),Task 9 冒烟时以 `monitor/data/logs` 报错为准,从 `market-data/tokopedia-fabric-top50/tokopedia_fabric_sofa_top50.json` 查最新 url 替换。

- [ ] **Step 4: 安装依赖并验证**

```bash
cd /Users/czq/sofa/monitor && npm install && npx playwright install chromium
node -e "console.log(require('playwright/package.json').version)"
```
Expected: `1.49.0`

- [ ] **Step 5: Commit**

```bash
cd /Users/czq/sofa && git add monitor/package.json monitor/package-lock.json monitor/monitor.config.json monitor/.gitignore
git commit -m "feat(monitor): scaffold + config with initial competitor list"
```

---

### Task 2: 纯解析函数 lib/parse.js(TDD)

**Files:**
- Create: `monitor/lib/parse.js`
- Test: `monitor/test/parse.test.js`

**Interfaces:**
- Produces:
  - `parsePrice(text: string): number|null` — "Rp1.220.000" → 1220000
  - `parseSoldLabel(text: string): {bucket: string, value: number}|null` — "2rb+ terjual"/"Terjual 750+" → {bucket:"2rb+",value:2000}
  - `parseRatingLine(text: string): {rating: number, ratingCount: number}|null` — "4.9 (649 rating)" 或 "649 rating • 448 ulasan" 配合页面提取

- [ ] **Step 1: 写失败测试**

```js
// monitor/test/parse.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, parseSoldLabel, parseRatingLine } from '../lib/parse.js';

test('parsePrice 解析印尼价格格式', () => {
  assert.equal(parsePrice('Rp1.220.000'), 1220000);
  assert.equal(parsePrice('Rp95.684'), 95684);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('Gratis'), null);
});

test('parseSoldLabel 解析销量分桶', () => {
  assert.deepEqual(parseSoldLabel('2rb+ terjual'), { bucket: '2rb+', value: 2000 });
  assert.deepEqual(parseSoldLabel('10rb+ terjual'), { bucket: '10rb+', value: 10000 });
  assert.deepEqual(parseSoldLabel('Terjual 750+'), { bucket: '750+', value: 750 });
  assert.deepEqual(parseSoldLabel('Terjual 1,2jt+'), { bucket: '1,2jt+', value: 1200000 });
  assert.deepEqual(parseSoldLabel('40+ terjual'), { bucket: '40+', value: 40 });
  assert.equal(parseSoldLabel('tidak ada'), null);
});

test('parseRatingLine 解析评分与评分人数', () => {
  assert.deepEqual(parseRatingLine('4.9 (649 rating)'), { rating: 4.9, ratingCount: 649 });
  assert.deepEqual(parseRatingLine('4.7 (117 rating)'), { rating: 4.7, ratingCount: 117 });
  assert.deepEqual(parseRatingLine('3.925 rating'), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/czq/sofa/monitor && npm test`
Expected: FAIL(Cannot find module '../lib/parse.js')

- [ ] **Step 3: 最小实现**

```js
// monitor/lib/parse.js
export function parsePrice(text) {
  const m = (text || '').match(/Rp\s?([\d.]+)/);
  if (!m) return null;
  return parseInt(m[1].replace(/\./g, ''), 10);
}

export function parseSoldLabel(text) {
  // 形态:"2rb+ terjual" / "Terjual 750+" / "Terjual 1,2jt+"
  const m = (text || '').match(/(?:terjual\s+)?([\d.,]+\s?(?:rb|jt)?\+?)(?:\s+terjual)?/i);
  if (!m || !/terjual/i.test(text || '')) return null;
  const bucket = m[1].replace(/\s/g, '');
  let num = parseFloat(bucket.replace(',', '.').replace(/[^\d.]/g, ''));
  if (isNaN(num)) return null;
  if (/jt/i.test(bucket)) num *= 1_000_000;
  else if (/rb/i.test(bucket)) num *= 1000;
  return { bucket, value: Math.round(num) };
}

export function parseRatingLine(text) {
  const m = (text || '').match(/(\d\.\d)\s*\(([\d.,]+)\s*rating\)/i);
  if (!m) return null;
  return { rating: parseFloat(m[1]), ratingCount: parseInt(m[2].replace(/[.,]/g, ''), 10) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/czq/sofa && git add monitor/lib/parse.js monitor/test/parse.test.js
git commit -m "feat(monitor): pure parsers for price/sold/rating with tests"
```

---

### Task 3: 抓 fixtures + browser.js 基础设施

**Files:**
- Create: `monitor/lib/browser.js`, `monitor/tools/capture-fixtures.js`, `monitor/fixtures/`(产物)

**Interfaces:**
- Produces:
  - `launch(): Promise<{browser, page, visit(url):Promise<'ok'|'blocked'>, close()}>` — visit 内置 8-20s 节奏与 verify/otp 熔断
  - fixtures:`fixtures/search.html`、`fixtures/product.html`、`fixtures/shop.html`(真实渲染后 outerHTML)

- [ ] **Step 1: 写 browser.js**

```js
// monitor/lib/browser.js
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
```

- [ ] **Step 2: 写 capture-fixtures.js**

```js
// monitor/tools/capture-fixtures.js — 本地跑一次,存真实页面供解析测试
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, slowScroll } from '../lib/browser.js';

const targets = [
  ['search.html', 'https://www.tokopedia.com/search?st=product&q=sofa%20bed%20minimalis&ob=8', true],
  ['product.html', 'https://www.tokopedia.com/meexistore/meexi-sofabed-density-23-sofa-bed-minimalis-sofa-tidur-sofa-kasur-sofa-vacuum-compressible-boneless-couch-sofa-kecil-untuk-kamar-sofa-untuk-ruang-tamu-sempit-tapi-mewah-kasur-sofa-1732127420746466525', false],
  ['shop.html', 'https://www.tokopedia.com/meexistore', true],
];

mkdirSync(new URL('../fixtures/', import.meta.url), { recursive: true });
const b = await launch({ fast: true });
for (const [name, url, scroll] of targets) {
  const r = await b.visit(url);
  if (r !== 'ok') { console.error(name, r); continue; }
  if (scroll) await slowScroll(b.page);
  const html = await b.page.content();
  writeFileSync(new URL(`../fixtures/${name}`, import.meta.url), html);
  console.log('saved', name, html.length);
}
await b.close();
```

- [ ] **Step 3: 本地执行抓 fixtures**

Run: `cd /Users/czq/sofa/monitor && node tools/capture-fixtures.js`
Expected: 输出三行 `saved xxx.html <字节数>`,每个 >200KB

- [ ] **Step 4: Commit(fixtures 一并入库——解析回归的基准)**

```bash
cd /Users/czq/sofa && git add monitor/lib/browser.js monitor/tools/capture-fixtures.js monitor/fixtures/
git commit -m "feat(monitor): browser infra with anti-block pacing + real fixtures"
```

---

### Task 4: DOM 提取器 scrape/keyword.js + scrape/product.js + scrape/shop.js(TDD,fixtures 驱动)

**Files:**
- Create: `monitor/scrape/keyword.js`, `monitor/scrape/product.js`, `monitor/scrape/shop.js`
- Test: `monitor/test/extract.test.js`

**Interfaces:**
- Consumes: `lib/browser.js` 的 page;`lib/parse.js`
- Produces(供 run.js 与 analyze.js 依赖的快照条目形状):
  - `extractKeyword(page, topN): Promise<Array<{rank,url,title,priceIdr,soldBucket,soldValue,rating,shopName,city}>>`
  - `extractProduct(page): Promise<{ok,priceIdr,originalPriceIdr,soldBucket,soldValue,rating,ratingCount,stock,variants:string[],origin}>`
  - `extractShop(page): Promise<{productUrls: string[]}>`

- [ ] **Step 1: 写失败测试(用 playwright setContent 加载 fixtures)**

```js
// monitor/test/extract.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { extractKeyword } from '../scrape/keyword.js';
import { extractProduct } from '../scrape/product.js';
import { extractShop } from '../scrape/shop.js';

let browser, page;
before(async () => { browser = await chromium.launch(); page = await browser.newPage(); });
after(async () => { await browser.close(); });

const load = (name) =>
  page.setContent(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'), { waitUntil: 'domcontentloaded' });

test('extractKeyword 从搜索页取出带价格的榜单', async () => {
  await load('search.html');
  const items = await extractKeyword(page, 20);
  assert.ok(items.length >= 10, `got ${items.length}`);
  assert.equal(items[0].rank, 1);
  assert.match(items[0].url, /tokopedia\.com/);
  assert.ok(items[0].priceIdr > 10000);
  assert.ok(items.every((i) => typeof i.title === 'string' && i.title.length > 0));
});

test('extractProduct 从商品页取出核心字段', async () => {
  await load('product.html');
  const p = await extractProduct(page);
  assert.equal(p.ok, true);
  assert.ok(p.priceIdr > 100000);
  assert.ok(p.ratingCount > 0);
  assert.ok(Array.isArray(p.variants));
});

test('extractShop 取出店铺商品链接集合', async () => {
  await load('shop.html');
  const s = await extractShop(page);
  assert.ok(s.productUrls.length >= 5, `got ${s.productUrls.length}`);
  assert.ok(s.productUrls.every((u) => u.startsWith('https://www.tokopedia.com/')));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: extract.test.js 三条 FAIL(模块不存在)

- [ ] **Step 3: 实现三个提取器**

```js
// monitor/scrape/keyword.js
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
    return {
      rank: i + 1,
      url: r.url,
      title: r.lines[0] && /%$/.test(r.lines[0]) ? (r.lines[1] || '') : (r.lines[0] || ''),
      priceIdr: parsePrice(r.priceText),
      soldBucket: sold?.bucket ?? null,
      soldValue: sold?.value ?? null,
      rating: r.ratingText ? parseFloat(r.ratingText) : null,
      shopName: tail[tail.length - 2] || '',
      city: tail[tail.length - 1] || '',
    };
  });
}
```

```js
// monitor/scrape/product.js
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
      soldText: g(/Terjual\s[\d.,a-z]+\+?/i),
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
```

```js
// monitor/scrape/shop.js
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
```

- [ ] **Step 4: 跑测试确认通过;失败则按 fixture 实际结构修启发式(不改测试断言的语义)**

Run: `npm test`
Expected: PASS(extract 3 tests + parse 3 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/czq/sofa && git add monitor/scrape/ monitor/test/extract.test.js
git commit -m "feat(monitor): DOM extractors for keyword/product/shop, fixture-tested"
```

---

### Task 5: fx.js 汇率 + lib/io.js 快照读写

**Files:**
- Create: `monitor/scrape/fx.js`, `monitor/lib/io.js`
- Test: 追加到 `monitor/test/parse.test.js`

**Interfaces:**
- Produces:
  - `fetchFx(): Promise<{idrPerCny: number}|null>`(exchangerate-api 免费端点,失败返 null)
  - `io.appendSnapshot(dataDir, dateStr, obj)` — 写 `snapshots/<date>.json`,存在则拒绝覆盖(抛错)
  - `io.readSeries(dataDir) / writeSeries(dataDir, series)` — 写前把现文件复制为 `series.json.bak`
  - `io.log(dataDir, line)` — 追加 `logs/<date>.log`

- [ ] **Step 1: 失败测试(io 的防覆盖与 .bak 行为)**

```js
// 追加到 monitor/test/parse.test.js
import { mkdtempSync, existsSync, readFileSync as rf } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as io from '../lib/io.js';

test('io.appendSnapshot 拒绝覆盖已有快照', () => {
  const d = mkdtempSync(join(tmpdir(), 'mon-'));
  io.appendSnapshot(d, '2026-07-08', { a: 1 });
  assert.throws(() => io.appendSnapshot(d, '2026-07-08', { a: 2 }));
  assert.deepEqual(JSON.parse(rf(join(d, 'snapshots', '2026-07-08.json'), 'utf8')), { a: 1 });
});

test('io.writeSeries 先备份 .bak', () => {
  const d = mkdtempSync(join(tmpdir(), 'mon-'));
  io.writeSeries(d, { v: 1 });
  io.writeSeries(d, { v: 2 });
  assert.equal(JSON.parse(rf(join(d, 'series.json.bak'), 'utf8')).v, 1);
  assert.equal(io.readSeries(d).v, 2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test` — Expected: FAIL(io 不存在)

- [ ] **Step 3: 实现**

```js
// monitor/lib/io.js
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export function appendSnapshot(dataDir, dateStr, obj) {
  const dir = join(dataDir, 'snapshots');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${dateStr}.json`);
  if (existsSync(f)) throw new Error(`snapshot exists: ${f}(快照只追加,不覆盖)`);
  writeFileSync(f, JSON.stringify(obj, null, 1));
}

export function readSeries(dataDir) {
  const f = join(dataDir, 'series.json');
  if (!existsSync(f)) return { products: {}, keywords: {}, fx: { points: [] }, reviews: {} };
  return JSON.parse(readFileSync(f, 'utf8'));
}

export function writeSeries(dataDir, series) {
  mkdirSync(dataDir, { recursive: true });
  const f = join(dataDir, 'series.json');
  if (existsSync(f)) copyFileSync(f, f + '.bak');
  writeFileSync(f, JSON.stringify(series));
}

export function log(dataDir, line) {
  const dir = join(dataDir, 'logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, new Date().toISOString().slice(0, 10) + '.log'),
    `[${new Date().toISOString()}] ${line}\n`);
}
```

```js
// monitor/scrape/fx.js
export async function fetchFx() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const idr = j?.rates?.IDR;
    return idr ? { idrPerCny: Math.round(idr) } : null;
  } catch { return null; }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/czq/sofa && git add monitor/scrape/fx.js monitor/lib/io.js monitor/test/parse.test.js
git commit -m "feat(monitor): fx fetcher + append-only snapshot io with bak"
```

---

### Task 6: analyze.js — series 更新与派生指标(TDD)

**Files:**
- Create: `monitor/analyze.js`
- Test: `monitor/test/analyze.test.js`

**Interfaces:**
- Consumes: 快照形状(Task 4/5 产出):`{date, keywords:{[key]:items[]}, products:{[id]:productObj}, shops:{[id]:{productUrls}}, fx, health:{...}}`
- Produces:
  - `updateSeries(series, snapshot, config): series`(纯函数,返回新对象)
  - series 内每商品点:`{d,price,origPrice,soldBucket,soldValue,rating,ratingCount,stock,variantCount,variants,origin,rank}`
  - `derive(series, config): {products:{[id]:{dailySales,restock,discountPct,ratingWeeklyDelta[]}}, keywords:{[key]:{medianPrice,minPrice}}}`(嵌在 updateSeries 输出的 `derived` 字段)

- [ ] **Step 1: 失败测试**

```js
// monitor/test/analyze.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateSeries, buildHighlights } from '../analyze.js';

const config = {
  thresholds: { priceChangePct: 5, rankShift: 5, ratingCountAccel: 1.5, fxChangePct: 3, missingDays: 2, restockMin: 20 },
  products: [{ id: 'p1', label: 'P1', primaryKeyword: 'kw', trackStock: true, url: 'https://x/p1' }],
  keywords: [{ key: 'kw', topN: 20 }],
  campaignCalendar: [],
};
const snapDay = (d, over = {}) => ({
  date: d,
  keywords: { kw: [{ rank: 1, url: 'https://x/p1', title: 'P1', priceIdr: 100000, soldBucket: '1rb+', soldValue: 1000, rating: 4.9, shopName: 's', city: 'c' }] },
  products: { p1: { ok: true, priceIdr: 100000, originalPriceIdr: 120000, soldBucket: '1rb+', soldValue: 1000, rating: 4.9, ratingCount: 100, stock: 80, variants: ['A', 'B'], origin: 'Kota X' } },
  shops: {}, fx: { idrPerCny: 2200 }, health: {},
  ...over,
});

test('updateSeries 追加点并计算派生指标', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, stock: 74, priceIdr: 90000 } },
  }), config);
  const pts = s.products.p1.points;
  assert.equal(pts.length, 2);
  assert.equal(s.derived.products.p1.dailySales, 6);          // 80-74 库存差=精确日销
  assert.equal(s.derived.products.p1.restock, false);
  assert.equal(s.derived.products.p1.discountPct, 25);        // (120000-90000)/120000
  assert.equal(s.derived.keywords.kw.medianPrice, 100000);
});

test('updateSeries 同日重跑幂等(不重复追点)', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-08'), config);
  assert.equal(s.products.p1.points.length, 1);
});

test('库存上跳识别为 restock 而非负日销', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, stock: 300 } },
  }), config);
  assert.equal(s.derived.products.p1.restock, true);
  assert.equal(s.derived.products.p1.dailySales, null);
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test` Expected: FAIL

- [ ] **Step 3: 实现 updateSeries(buildHighlights 先导出空实现 `()=>[]`,Task 7 完成)**

```js
// monitor/analyze.js
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
```

- [ ] **Step 4: 跑测试确认通过** — `npm test` Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/czq/sofa && git add monitor/analyze.js monitor/test/analyze.test.js
git commit -m "feat(monitor): series update + derived metrics (stock-diff daily sales)"
```

---

### Task 7: analyze.js — 高亮规则引擎(TDD)

**Files:**
- Modify: `monitor/analyze.js`(替换 buildHighlights 空实现)
- Test: 追加到 `monitor/test/analyze.test.js`

**Interfaces:**
- Produces: `buildHighlights(series, config, today: 'YYYY-MM-DD'): Array<{level:'red'|'yellow'|'info', icon, text, url}>`
  规则集:价格异动/销量跳桶/评分加速/新玩家入榜/排名异动/连续缺数/补货事件/变体增减/店铺上新/发货地变更/汇率异动/大促窗口标注

- [ ] **Step 1: 失败测试(核心规则逐条)**

```js
// 追加到 monitor/test/analyze.test.js
test('规则:价格异动≥5% 触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, priceIdr: 90000 } },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '💰' && /P1/.test(x.text) && /-10/.test(x.text)));
});

test('规则:销量跳桶触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, soldBucket: '2rb+', soldValue: 2000 } },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '📈' && /1rb\+ → 2rb\+/.test(x.text)));
});

test('规则:新玩家进 Top10 触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    keywords: { kw: [
      { rank: 1, url: 'https://x/newcomer', title: 'NEW', priceIdr: 88000, soldBucket: null, soldValue: null, rating: null, shopName: 'n', city: 'c' },
      ...snapDay('x').keywords.kw.map((i) => ({ ...i, rank: 2 })),
    ] },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '🆕' && /newcomer|NEW/.test(x.text + x.url)));
});

test('规则:变体增减触发', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  s = updateSeries(s, snapDay('2026-07-09', {
    products: { p1: { ...snapDay('x').products.p1, variants: ['A', 'B', 'C'] } },
  }), config);
  const h = buildHighlights(s, config, '2026-07-09');
  assert.ok(h.some((x) => x.icon === '🎨' && /\+C/.test(x.text)));
});

test('规则:连续缺数触发红条', () => {
  let s = updateSeries(undefined, snapDay('2026-07-08'), config);
  // 07-09、07-10 两天没有 p1 数据(快照里 products 为空)
  s = updateSeries(s, snapDay('2026-07-09', { products: {} }), config);
  s = updateSeries(s, snapDay('2026-07-10', { products: {} }), config);
  const h = buildHighlights(s, config, '2026-07-10');
  assert.ok(h.some((x) => x.level === 'red' && x.icon === '⚠️' && /P1/.test(x.text)));
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test` Expected: 新增 5 条 FAIL

- [ ] **Step 3: 实现 buildHighlights(替换空实现)**

```js
// monitor/analyze.js 中替换:
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
```

- [ ] **Step 4: 跑测试确认通过** — `npm test` Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/czq/sofa && git add monitor/analyze.js monitor/test/analyze.test.js
git commit -m "feat(monitor): highlight rules engine (12 rules, sorted by severity)"
```

---

### Task 8: run.js 编排(daily / weekly / --dry-run)

**Files:**
- Create: `monitor/run.js`, `monitor/scrape/reviews.js`

**Interfaces:**
- Consumes: 前述全部模块
- Produces: CLI `node run.js daily [--dry-run]` / `node run.js weekly`;输出 `data/snapshots/<date>.json`、`data/series.json`、`out/monitor_data/{series,highlights,health}.json`、`out/competitor-monitor.html`(从 dashboard/ 拷贝)

- [ ] **Step 1: 写 reviews.js(weekly 用,复用本会话验证过的低星过滤交互)**

```js
// monitor/scrape/reviews.js — 打开 PDP,点低星过滤,统计负面关键词
import { slowScroll } from '../lib/browser.js';

export async function scanReviews(page, negativeKeywords) {
  await slowScroll(page, 10);
  const texts = await page.evaluate(async () => {
    const collect = () => [...document.querySelectorAll('article')]
      .map((n) => n.innerText).filter((t) => t.length > 40 && t.length < 1200 && /lalu/.test(t));
    const clickStar = async (star) => {
      const btns = [...document.querySelectorAll('button, [role="button"], label')]
        .filter((e) => e.innerText?.trim() === star);
      if (!btns.length) return false;
      btns[0].click();
      await new Promise((r) => setTimeout(r, 1600));
      return true;
    };
    let all = [];
    for (const s of ['1', '2', '3']) {
      if (await clickStar(s)) { all = all.concat(collect()); await clickStar(s); }
    }
    return all;
  });
  const kw = {};
  for (const k of negativeKeywords) kw[k] = texts.filter((t) => t.toLowerCase().includes(k)).length;
  return { lowStarSampled: texts.length, kw };
}
```

- [ ] **Step 2: 写 run.js**

```js
// monitor/run.js
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, slowScroll } from './lib/browser.js';
import { extractKeyword } from './scrape/keyword.js';
import { extractProduct } from './scrape/product.js';
import { extractShop } from './scrape/shop.js';
import { fetchFx } from './scrape/fx.js';
import { scanReviews } from './scrape/reviews.js';
import { updateSeries, buildHighlights } from './analyze.js';
import * as io from './lib/io.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.MONITOR_DATA ?? join(ROOT, 'data');
const OUT = process.env.MONITOR_OUT ?? join(ROOT, 'out');
const config = JSON.parse(readFileSync(join(ROOT, 'monitor.config.json'), 'utf8'));
const mode = process.argv[2];
const dry = process.argv.includes('--dry-run');
const today = new Date().toISOString().slice(0, 10);

const searchUrl = (q) => `https://www.tokopedia.com/search?st=product&q=${encodeURIComponent(q)}&ob=8`;

async function daily() {
  const keywords = dry ? config.keywords.slice(0, 1) : config.keywords;
  const products = dry ? config.products.slice(0, 2) : config.products;
  const shops = dry ? [] : config.shops;
  const snap = { date: today, keywords: {}, products: {}, shops: {}, fx: null, health: { blocked: false, errors: [] } };
  const b = await launch();
  try {
    for (const k of keywords) {
      const r = await b.visit(searchUrl(k.key));
      if (r === 'blocked') { snap.health.blocked = true; break; }
      if (r !== 'ok') { snap.health.errors.push(`keyword:${k.key}:${r}`); continue; }
      await slowScroll(b.page);
      try { snap.keywords[k.key] = await extractKeyword(b.page, k.topN); }
      catch (e) { snap.health.errors.push(`keyword:${k.key}:parse:${e.message}`); }
    }
    if (!snap.health.blocked) for (const p of products) {
      let r = await b.visit(p.url);
      if (r === 'error') { await new Promise((x) => setTimeout(x, 30000)); r = await b.visit(p.url); } // 重试1次
      if (r === 'blocked') { snap.health.blocked = true; break; }
      if (r !== 'ok') { snap.health.errors.push(`product:${p.id}:${r}`); continue; }
      try { snap.products[p.id] = await extractProduct(b.page); }
      catch (e) { snap.health.errors.push(`product:${p.id}:parse:${e.message}`); }
    }
    if (!snap.health.blocked) for (const sh of shops) {
      const r = await b.visit(sh.url);
      if (r === 'blocked') { snap.health.blocked = true; break; }
      if (r !== 'ok') { snap.health.errors.push(`shop:${sh.id}:${r}`); continue; }
      await slowScroll(b.page, 6);
      try { snap.shops[sh.id] = await extractShop(b.page); }
      catch (e) { snap.health.errors.push(`shop:${sh.id}:parse:${e.message}`); }
    }
  } finally { await b.close(); }
  snap.fx = await fetchFx();

  io.appendSnapshot(DATA, today, snap);
  const series = updateSeries(io.readSeries(DATA), snap, config);
  io.writeSeries(DATA, series);
  const highlights = buildHighlights(series, config, today);

  publish(series, highlights, snap.health);
  io.log(DATA, `daily done: kw=${Object.keys(snap.keywords).length} prod=${Object.keys(snap.products).length} shops=${Object.keys(snap.shops).length} blocked=${snap.health.blocked} errors=${snap.health.errors.length} highlights=${highlights.length}`);
  if (snap.health.blocked) process.exitCode = 2;
}

async function weekly() {
  const series = io.readSeries(DATA);
  const week = `${today.slice(0, 4)}-W${String(Math.ceil((new Date(today) - new Date(today.slice(0, 4) + '-01-01')) / 604800000)).padStart(2, '0')}`;
  const b = await launch();
  try {
    for (const p of config.products) {
      const r = await b.visit(p.url);
      if (r === 'blocked') break;
      if (r !== 'ok') continue;
      try {
        const rv = await scanReviews(b.page, config.negativeKeywords);
        series.reviews[p.id] ??= { points: [] };
        const pts = series.reviews[p.id].points;
        if (!(pts.length && pts[pts.length - 1].w === week)) pts.push({ w: week, ...rv });
      } catch (e) { io.log(DATA, `weekly:${p.id}:${e.message}`); }
    }
  } finally { await b.close(); }
  io.writeSeries(DATA, series);
  publish(series, buildHighlights(series, config, today), {});
  io.log(DATA, `weekly done`);
}

function publish(series, highlights, health) {
  const dataOut = join(OUT, 'monitor_data');
  mkdirSync(dataOut, { recursive: true });
  writeFileSync(join(dataOut, 'series.json'), JSON.stringify(series));
  writeFileSync(join(dataOut, 'highlights.json'), JSON.stringify({ date: today, items: highlights }));
  writeFileSync(join(dataOut, 'health.json'), JSON.stringify({ date: today, ...health }));
  copyFileSync(join(ROOT, 'dashboard/competitor-monitor.html'), join(OUT, 'competitor-monitor.html'));
}

if (mode === 'daily') await daily();
else if (mode === 'weekly') await weekly();
else { console.error('用法: node run.js daily|weekly [--dry-run]'); process.exit(1); }
```

- [ ] **Step 3: 冒烟(dashboard 还没写,先建占位文件)**

```bash
cd /Users/czq/sofa/monitor
mkdir -p dashboard && [ -f dashboard/competitor-monitor.html ] || echo '<!doctype html>占位' > dashboard/competitor-monitor.html
node run.js daily --dry-run
cat data/snapshots/$(date +%F).json | head -40
cat out/monitor_data/highlights.json
```
Expected: 快照含 1 个关键词 20 条 + 2 个商品字段齐全;highlights.json 存在(首日可为空数组);exit code 0

- [ ] **Step 4: Commit**

```bash
cd /Users/czq/sofa && git add monitor/run.js monitor/scrape/reviews.js monitor/dashboard/
git commit -m "feat(monitor): daily/weekly orchestration with dry-run + degraded health"
```

---

### Task 9: Dashboard 静态页

**Files:**
- Create: `monitor/dashboard/competitor-monitor.html`(替换占位)

**Interfaces:**
- Consumes: `monitor_data/series.json`、`monitor_data/highlights.json`、`monitor_data/health.json`(同目录相对路径 fetch)
- Produces: 五区页面(要点/竞品大表/关键词战场/弱点雷达/环境条),货柜作战板设计语言,自包含无外部依赖

- [ ] **Step 1: 写完整页面**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>竞品监控 · 印尼沙发战场</title>
<style>
:root{--ink:#1A2130;--paper:#ECEFEA;--card:#F7F8F5;--indigo:#2B4C7E;--cargo:#E4572E;--leaf:#21735B;--line:#C4CBC2;
--mono:ui-monospace,'SF Mono',Menlo,monospace;--sans:'PingFang SC','Noto Sans SC',sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.6}
.wrap{max-width:1200px;margin:0 auto;padding:26px 18px 60px}
h1{font-size:clamp(22px,3.4vw,30px);font-weight:900}
h1 em{font-style:normal;color:var(--cargo)}
.sub{font-family:var(--mono);font-size:12px;color:#5c6577;letter-spacing:.1em;margin:4px 0 18px}
.banner{padding:10px 16px;font-size:13.5px;font-weight:700;margin-bottom:14px;display:none}
.banner.red{display:block;background:#B3261E;color:#fff}
.banner.yellow{display:block;background:#F2C14E;color:#5c4a00}
h2{font-size:18px;font-weight:900;border-bottom:2px solid var(--ink);padding-bottom:6px;margin:30px 0 14px}
.hl{list-style:none}
.hl li{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--indigo);padding:9px 14px;margin-bottom:8px;font-size:14px}
.hl li.red{border-left-color:#B3261E}.hl li.yellow{border-left-color:var(--cargo)}
.hl a{color:var(--indigo)}
table{width:100%;border-collapse:collapse;background:var(--card);font-size:12.5px}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap}
th{background:var(--ink);color:#EDEFE8;font-family:var(--mono);font-size:11px;letter-spacing:.06em}
td:first-child,th:first-child{text-align:left}
.tbl-scroll{overflow-x:auto}
svg.spark{vertical-align:middle}
.kwgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.kwcard{background:var(--card);border:1px solid var(--line);padding:12px 14px}
.kwcard h3{font-size:14px;font-weight:800;margin-bottom:6px}
.kwcard .meta{font-family:var(--mono);font-size:12px;color:#5c6577}
.bars{display:flex;flex-direction:column;gap:6px}
.bars .row{display:grid;grid-template-columns:150px 1fr auto;gap:8px;font-size:12.5px;align-items:center}
.bars .bar{height:12px;background:var(--cargo);min-width:2px}
footer{margin-top:36px;font-family:var(--mono);font-size:11px;color:#7a8294;border-top:1px solid var(--line);padding-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <h1>竞品监控 · <em>印尼沙发战场</em></h1>
  <div class="sub" id="sub">加载中…</div>
  <div class="banner" id="banner"></div>

  <h2>本周要点</h2>
  <ul class="hl" id="hl"></ul>

  <h2>竞品清单</h2>
  <div class="tbl-scroll"><table id="ptable">
    <thead><tr><th>竞品</th><th>现价 Rp</th><th>折扣</th><th>销量桶</th><th>评分数(周增)</th><th>库存日销(14d)</th><th>库存</th><th>排名</th></tr></thead>
    <tbody></tbody>
  </table></div>

  <h2>关键词战场</h2>
  <div class="kwgrid" id="kwgrid"></div>

  <h2>弱点雷达(每周差评关键词)</h2>
  <div class="bars" id="weak"></div>

  <h2>环境</h2>
  <div class="kwcard" id="env"></div>

  <footer id="foot"></footer>
</div>
<script>
const fmt = (n) => n == null ? '—' : n.toLocaleString('id-ID');
function spark(vals, w = 110, h = 22, color = '#2B4C7E') {
  const v = vals.filter((x) => x != null);
  if (v.length < 2) return '<span style="color:#aaa">—</span>';
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const pts = vals.map((x, i) => x == null ? null : `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (x - min) / rng * (h - 4)).toFixed(1)}`).filter(Boolean);
  return `<svg class="spark" width="${w}" height="${h}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts.join(' ')}"/></svg>`;
}
(async () => {
  const [series, hl, health] = await Promise.all(
    ['series.json', 'highlights.json', 'health.json'].map((f) => fetch('monitor_data/' + f).then((r) => r.json()))
  );
  document.getElementById('sub').textContent =
    `数据日期 ${hl.date} · TOKOPEDIA 每日抓取 · 库存差分=精确日销 · Toko销量为累计分桶`;

  // 健康横幅
  const daysStale = Math.round((Date.now() - new Date(hl.date)) / 86400000);
  const banner = document.getElementById('banner');
  if (daysStale >= 2) { banner.className = 'banner red'; banner.textContent = `⚠ 数据已 ${daysStale} 天未更新,检查服务器 cron / 日志`; }
  else if (health.blocked || (health.errors ?? []).length > 3) { banner.className = 'banner yellow'; banner.textContent = `⚠ 最近一次抓取降级:blocked=${health.blocked} errors=${(health.errors ?? []).length}`; }

  // 要点
  document.getElementById('hl').innerHTML = (hl.items ?? []).map((x) =>
    `<li class="${x.level}">${x.icon} ${x.text}${x.url ? ` <a href="${x.url}" target="_blank">→</a>` : ''}</li>`
  ).join('') || '<li>今日无触发规则,一切平稳</li>';

  // 竞品大表(config 顺序即 series.products key 顺序)
  const tb = document.querySelector('#ptable tbody');
  tb.innerHTML = Object.entries(series.products).map(([id, pd]) => {
    const pts = pd.points, last = pts[pts.length - 1] ?? {};
    const dv = series.derived?.products?.[id] ?? {};
    const wd = dv.ratingWeeklyDelta ?? [];
    const stocks = pts.slice(-15).map((x) => x.stock);
    const daily = stocks.slice(1).map((s, i) => (stocks[i] != null && s != null && stocks[i] - s >= 0) ? stocks[i] - s : null);
    return `<tr><td><a href="${pts.length ? '' : ''}#" onclick="return false">${id}</a></td>
      <td>${fmt(last.price)}</td><td>${dv.discountPct != null ? dv.discountPct + '%' : '—'}</td>
      <td>${last.soldBucket ?? '—'}</td>
      <td>${fmt(last.ratingCount)}${wd.length ? ` (+${wd[wd.length - 1]})` : ''}</td>
      <td>${spark(daily, 110, 22, '#E4572E')}</td>
      <td>${fmt(last.stock)}</td><td>${last.rank ?? '—'}</td></tr>`;
  }).join('');

  // 关键词战场
  document.getElementById('kwgrid').innerHTML = Object.entries(series.keywords).map(([k, kd]) => {
    const pts = kd.points, last = pts[pts.length - 1] ?? {};
    const med = pts.slice(-30).map((x) => x.medianPrice);
    return `<div class="kwcard"><h3>${k}</h3>
      <div class="meta">中位 Rp${fmt(last.medianPrice)} · 最低 Rp${fmt(last.minPrice)}</div>
      ${spark(med, 300, 34)}</div>`;
  }).join('');

  // 弱点雷达
  const weak = document.getElementById('weak');
  const rows = [];
  for (const [id, rv] of Object.entries(series.reviews ?? {})) {
    const last = rv.points[rv.points.length - 1];
    if (!last) continue;
    for (const [kw, n] of Object.entries(last.kw)) if (n > 0) rows.push({ id, kw, n });
  }
  rows.sort((a, b) => b.n - a.n);
  weak.innerHTML = rows.length ? rows.map((r) =>
    `<div class="row"><span>${r.id} · ${r.kw}</span><span class="bar" style="width:${Math.min(r.n * 24, 480)}px"></span><b>${r.n}</b></div>`
  ).join('') : '<div class="row"><span>暂无每周评论数据(周一凌晨生成)</span></div>';

  // 环境
  const fx = series.fx.points;
  document.getElementById('env').innerHTML =
    `<div class="meta">IDR/CNY:现 ${fmt(fx[fx.length - 1]?.idrPerCny)} · 30日 ${spark(fx.slice(-30).map((x) => x.idrPerCny), 240, 30, '#21735B')}</div>`;
  document.getElementById('foot').textContent =
    `快照只追加 · series 带 .bak · 规则阈值见 monitor.config.json · 生成于 run.js publish()`;
})().catch((e) => { document.getElementById('sub').textContent = '数据加载失败:' + e.message; });
</script>
</body>
</html>
```

- [ ] **Step 2: 本地验收(用 dry-run 数据)**

```bash
cd /Users/czq/sofa/monitor && node run.js daily --dry-run 2>/dev/null || true
# dry-run 当日已跑过会因快照防覆盖而退出,此时直接用已有数据
cd out && python3 -m http.server 8932 &
sleep 1 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8932/competitor-monitor.html
```
Expected: 200;浏览器打开 http://localhost:8932/competitor-monitor.html,五区渲染、竞品表有 2 行、无 JS 报错。验收后 `pkill -f "http.server 8932"`

- [ ] **Step 3: Commit**

```bash
cd /Users/czq/sofa && git add monitor/dashboard/competitor-monitor.html
git commit -m "feat(monitor): static dashboard (5 sections, self-contained)"
```

---

### Task 10: 部署脚本 + 服务器 Docker 环境

**Files:**
- Create: `monitor/deploy/run-daily.sh`, `monitor/deploy/run-weekly.sh`, `monitor/deploy/crontab.txt`

**Interfaces:**
- Consumes: 服务器 root@106.55.199.206(ssh 端口22,sshpass 已装于本机)
- Produces: 服务器 `/home/monitor` 运行时;宿主 cron 两条

- [ ] **Step 1: 写部署脚本**

```bash
# monitor/deploy/run-daily.sh
#!/bin/bash
set -u
D=/home/monitor
IMG=mcr.microsoft.com/playwright:v1.49.0-jammy
mkdir -p "$D/data/logs"
LOG="$D/data/logs/host-$(date +%F).log"
{
  echo "=== daily $(date -Is) ==="
  docker run --rm --shm-size=1g -v "$D":/work -w /work "$IMG" \
    bash -lc '[ -d node_modules ] || npm ci --omit=dev; node run.js daily'
  RC=$?
  echo "exit=$RC"
  if [ $RC -ne 0 ]; then touch "$D/data/logs/FAILED-$(date +%F)"; fi
  # 发布:仅当产物存在才覆盖(渲染失败不白屏)
  if [ -s "$D/out/competitor-monitor.html" ]; then
    cp -f "$D/out/competitor-monitor.html" /usr/share/nginx/html/
    mkdir -p /usr/share/nginx/html/monitor_data
    cp -f "$D"/out/monitor_data/*.json /usr/share/nginx/html/monitor_data/
    echo "published"
  fi
} >>"$LOG" 2>&1
```

```bash
# monitor/deploy/run-weekly.sh
#!/bin/bash
set -u
D=/home/monitor
IMG=mcr.microsoft.com/playwright:v1.49.0-jammy
LOG="$D/data/logs/host-$(date +%F).log"
{
  echo "=== weekly $(date -Is) ==="
  docker run --rm --shm-size=1g -v "$D":/work -w /work "$IMG" \
    bash -lc 'node run.js weekly'
  [ -s "$D/out/monitor_data/series.json" ] && cp -f "$D"/out/monitor_data/*.json /usr/share/nginx/html/monitor_data/
} >>"$LOG" 2>&1
```

```
# monitor/deploy/crontab.txt — 服务器为北京时间(部署时用 date 核实):04:00京=03:00WIB 低峰
0 4 * * * /home/monitor/deploy/run-daily.sh
30 5 * * 1 /home/monitor/deploy/run-weekly.sh
```

- [ ] **Step 2: 服务器装 Docker(CentOS 7)并拉镜像**

```bash
sshpass -p '<密码见会话>' ssh -o StrictHostKeyChecking=no root@106.55.199.206 '
  docker --version 2>/dev/null || (yum install -y yum-utils && \
    yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo && \
    yum install -y docker-ce docker-ce-cli containerd.io && systemctl enable --now docker)
  docker --version && date
  docker pull mcr.microsoft.com/playwright:v1.49.0-jammy | tail -1'
```
Expected: 输出 docker 版本、服务器当前时间(核对时区)、镜像拉取完成。**若 yum 源失败(CentOS 7 EOL 镜像源问题)→ 触发设计文档 §8 备选:停止本任务,改走 GitHub Actions 方案(需另立计划)**

- [ ] **Step 3: rsync 代码上服务器(排除本地 node_modules——容器内是 linux,须重装)**

```bash
cd /Users/czq/sofa/monitor
chmod +x deploy/run-daily.sh deploy/run-weekly.sh
sshpass -p '<密码>' rsync -az --delete \
  --exclude node_modules --exclude data --exclude out --exclude fixtures \
  -e "ssh -o StrictHostKeyChecking=no" ./ root@106.55.199.206:/home/monitor/
```

- [ ] **Step 4: 服务器手动全量跑一次(首跑含 npm ci,时间较长)**

```bash
sshpass -p '<密码>' ssh -o StrictHostKeyChecking=no root@106.55.199.206 \
  '/home/monitor/deploy/run-daily.sh; tail -5 /home/monitor/data/logs/host-$(date +%F).log; ls -la /home/monitor/out/monitor_data/'
```
Expected: 日志尾部 `exit=0` + `published`;monitor_data 下三个 json。若 `daily done` 行显示 blocked=true,检查是否 IP 被拦(可接受偶发,连续则调研)

- [ ] **Step 5: 装 cron**

```bash
sshpass -p '<密码>' ssh -o StrictHostKeyChecking=no root@106.55.199.206 \
  '(crontab -l 2>/dev/null | grep -v run-daily.sh | grep -v run-weekly.sh; cat /home/monitor/deploy/crontab.txt) | crontab - && crontab -l'
```
Expected: crontab -l 显示两条

- [ ] **Step 6: Commit**

```bash
cd /Users/czq/sofa && git add monitor/deploy/
git commit -m "feat(monitor): server deploy scripts + cron (docker/playwright)"
```

---

### Task 11: nginx 发布 + 工具台入口 + 文档

**Files:**
- Modify: 服务器 `/etc/nginx/conf.d/sofa.conf`(加 2 个 location)
- Modify: `tools/home.html`(入口卡)、`CLAUDE.md`(映射表 + monitor 说明)

**Interfaces:**
- Produces: https://sofa.wefishing.cn/competitor-monitor.html 可访问

- [ ] **Step 1: nginx 加 location(照现有模式:备份→插入→nginx -t→reload)**

```bash
sshpass -p '<密码>' ssh -o StrictHostKeyChecking=no root@106.55.199.206 '
cp /etc/nginx/conf.d/sofa.conf /etc/nginx/conf.d/sofa.conf.bak.$(date +%Y%m%d%H%M%S)
python3 - << "EOF"
p="/etc/nginx/conf.d/sofa.conf"
s=open(p).read()
block = """    # 竞品监控(静态,精确匹配)
    location = /competitor-monitor.html {
        root /usr/share/nginx/html;
        default_type text/html;
        add_header Cache-Control "no-cache";
    }

    # 竞品监控数据
    location ^~ /monitor_data/ {
        root /usr/share/nginx/html;
        add_header Cache-Control "no-cache";
    }

    location / {"""
if "/competitor-monitor.html" in s: print("already present")
else:
    open(p,"w").write(s.replace("    location / {", block, 1)); print("inserted")
EOF
nginx -t && systemctl reload nginx && echo RELOADED'
curl -s -o /dev/null -w '%{http_code}\n' https://sofa.wefishing.cn/competitor-monitor.html
```
Expected: `inserted` + `RELOADED` + `200`

- [ ] **Step 2: tools/home.html 加入口卡(插在选品作战板卡之后)**

```html
    <a class="card" href="/competitor-monitor.html">
      <div class="ic b">📡</div>
      <div class="tx">
        <div class="tt">竞品监控日报</div>
        <div class="ds">Tokopedia 每日自动盯盘:价格 / 跳桶 / 库存日销 / 上新 / 新玩家 / 汇率,本周要点自动高亮</div>
      </div>
      <div class="ar">→</div>
    </a>
```
并 scp 上线:`sshpass -p '<密码>' scp -o StrictHostKeyChecking=no tools/home.html root@106.55.199.206:/usr/share/nginx/html/`

- [ ] **Step 3: CLAUDE.md 更新(映射表加两行 + monitor 一段)**

映射表追加:
```
| monitor/dashboard/competitor-monitor.html(容器每日发布) | /competitor-monitor.html + /monitor_data/ |
```
新增小节:
```
## 竞品监控(monitor/)
每日 04:00(京)服务器 Docker 跑 Tokopedia 抓取,数据在服务器 /home/monitor/data(快照只追加)。
改监控对象=改 monitor/monitor.config.json 后 rsync(见 monitor/deploy/)。排障:服务器 /home/monitor/data/logs/。
设计:docs/superpowers/specs/2026-07-07-competitor-monitor-design.md
```

- [ ] **Step 4: Commit**

```bash
cd /Users/czq/sofa && git add tools/home.html CLAUDE.md
git commit -m "feat(monitor): publish dashboard to tool station + docs"
```

---

### Task 12: 验收核对(3 天观察 + 差分抽查)

**Files:** 无新文件(操作性验收)

- [ ] **Step 1: 次日检查自动运行**

```bash
sshpass -p '<密码>' ssh root@106.55.199.06 'ls /home/monitor/data/snapshots/ && tail -3 /home/monitor/data/logs/host-$(date +%F).log' 2>/dev/null || \
sshpass -p '<密码>' ssh root@106.55.199.206 'ls /home/monitor/data/snapshots/ && tail -3 /home/monitor/data/logs/host-$(date +%F).log'
```
Expected: 今日快照存在,exit=0

- [ ] **Step 2: 第 3 天人工核对差分**

打开 dashboard,任选 2 个竞品:手动访问其 Tokopedia 页面,核对 现价/评分数/库存 与表格一致;库存日销 sparkline 数值 = 前日库存-今日库存

- [ ] **Step 3: 验收宣告条件(设计 §7)**

- 连续 7 天无人工干预日更(快照 7 个 + 页面 sub 日期滚动)
- 高亮至少命中 1 次真实事件且人工核实
- 每周要点 ≤10 条;若刷屏 → 调 `monitor.config.json` thresholds 后 rsync

- [ ] **Step 4: 完成后更新记忆**

在 `/Users/czq/.claude/projects/-Users-czq-sofa/memory/` 新增/更新监控系统指针(部署位置、改配置流程、排障入口),MEMORY.md 加一行。

---

## Self-Review 记录

- **Spec 覆盖**:设计 §2 决策表(运行/对象/输出/频率/架构)→ Task 1/8/9/10;§3 指标全集 → 每日核心=Task 6/7,每周=Task 8 reviews + Task 9 弱点雷达,环境层=Task 5 fx + Task 7 大促;§5 组件 → Task 2-9 一一对应;§6 错误处理 → browser 熔断(T3)/重试与 degraded(T8)/防覆盖 .bak(T5)/发布保护(T10 wrapper)/下架高亮(T7);§7 测试 → fixtures(T3/4)、纯函数(T2/6/7)、冒烟(T8)、部署验收(T10/12);§8 风险 → T10 Step2 内嵌 Docker 失败→Actions 决策点。无缺口。
- **占位符扫描**:无 TBD;`<密码>` 为会话内已知凭据的有意脱敏(不入库),执行者从会话历史取得。
- **类型一致性**:快照形状(T8 产出)与 updateSeries 消费(T6 测试构造)字段一致(keywords/products/shops/fx/health);extractProduct 返回字段与 series 点字段映射在 T6 updateSeries 中逐一显式;highlights 形状 {level,icon,text,url} 与 dashboard 渲染一致。

---

### Task 10-R(修订): GitHub Actions 执行环境(替代 Docker 方案,探针已实证)

背景:腾讯云对 Tokopedia 应用层黑洞;GitHub 云机 curl/headless 被 TLS 指纹拦,但 **headed 真 Chrome + xvfb 实测可达**(run 28927182180:title 正常,cards=10)。架构改为:GitHub Actions=无状态算力,服务器=数据真源+展示。

**Files:**
- Modify: `monitor/lib/browser.js`(env 开关 headed 模式)
- Create: `.github/workflows/daily.yml`, `.github/workflows/weekly.yml`
- Server: `/home/monitor/data` 目录 + authorized_keys 加专用公钥
- Secrets: `SSH_PRIVATE_KEY`(专用密钥)、`SERVER_HOST`

**Interfaces:**
- Consumes: run.js daily/weekly(MONITOR_DATA/MONITOR_OUT env 已支持)
- Produces: 每日 UTC 20:00(WIB 03:00)自动跑,数据 rsync 回服务器 /home/monitor/data,产物发布到 /usr/share/nginx/html

- [ ] Step 1: browser.js 加 headed 开关:`const headed = process.env.MONITOR_HEADED === '1';` launch 参数改 `chromium.launch(headed ? { headless: false, channel: 'chrome' } : { headless: true })`。npm test 回归(18条,fixtures 测试不受影响)。
- [ ] Step 2: 生成专用 ssh 密钥对(本地 ssh-keygen -t ed25519 -f /tmp/monitor_key -N ''),公钥追加到服务器 /root/.ssh/authorized_keys,私钥 `gh secret set SSH_PRIVATE_KEY < /tmp/monitor_key`,`gh secret set SERVER_HOST -b 106.55.199.206`,验证 key 登录后删除本地私钥文件。
- [ ] Step 3: daily.yml:
```yaml
name: daily-monitor
on:
  schedule: [{cron: '0 20 * * *'}]
  workflow_dispatch:
concurrency: {group: monitor, cancel-in-progress: false}
jobs:
  daily:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - name: setup ssh
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          echo "StrictHostKeyChecking no" >> ~/.ssh/config
      - name: install deps
        run: cd monitor && npm ci
      - name: pull data from server
        run: rsync -az root@${{ secrets.SERVER_HOST }}:/home/monitor/data/ monitor/data/ || true
      - name: run daily (headed chrome via xvfb)
        env: {MONITOR_HEADED: '1'}
        run: cd monitor && xvfb-run --auto-servernum node run.js daily
      - name: push data + publish
        if: always()
        run: |
          rsync -az monitor/data/ root@${{ secrets.SERVER_HOST }}:/home/monitor/data/
          if [ -s monitor/out/competitor-monitor.html ]; then
            rsync -az monitor/out/competitor-monitor.html root@${{ secrets.SERVER_HOST }}:/usr/share/nginx/html/
            rsync -az monitor/out/monitor_data/ root@${{ secrets.SERVER_HOST }}:/usr/share/nginx/html/monitor_data/
          fi
```
- [ ] Step 4: weekly.yml 同构:cron '30 21 * * 1',run.js weekly,同样 pull/push。
- [ ] Step 5: 手动 dispatch daily.yml 冒烟:成功标准 = run 绿;服务器 /home/monitor/data/snapshots/ 出现当日快照且 keywords≥4 个词有数据、products≥10 个有 price;/usr/share/nginx/html/monitor_data/series.json 更新。
- [ ] Step 6: 提交(browser.js + workflows),推送。

---

### Task 10-S(最终修订): 抓取主机 = 62.112.138.227(海外VPS),展示仍在 106.55

数据流:62.112(Docker+cron 抓取,数据真源 /home/monitor/data)→ 产物 scp → 106.55 /usr/share/nginx/html(sofa.wefishing.cn 展示)。GitHub Actions 方案(10-R)搁置备用,probe workflow 保留。

- [ ] Step 0 分层探针(决策点):ssh 62.112 查 OS/内存/磁盘/date/docker;curl tokopedia(仅参考,curl 指纹可能被全网拦);真正判据 = 容器内 playwright headless chromium 打开搜索页;失败再试 npx playwright install chrome + xvfb-run headed。两层都失败 → BLOCKED 报告。
- [ ] Step 1 browser.js 加 MONITOR_HEADED=1 开关(headless:false, channel:'chrome')+ npm test 回归。
- [ ] Step 2 62.112 装 Docker(按 OS 用对应源),拉 mcr.microsoft.com/playwright:v1.49.0-jammy。
- [ ] Step 3 rsync monitor/ 到 62.112:/home/monitor(排除 node_modules/data/out/fixtures);容器内 npm ci。
- [ ] Step 4 生成 62.112→106.55 的专用 ssh 密钥(62.112 上 ssh-keygen ed25519 无口令),公钥加到 106.55 authorized_keys;run-daily.sh 发布段改为:本地产物先落 /home/monitor/out,再 scp -i 该密钥到 106.55 的 nginx 目录(html + monitor_data/)。按探针结果决定容器命令是否 xvfb-run + MONITOR_HEADED=1。
- [ ] Step 5 手动全量跑:成功标准 = ≥4 关键词有数据 + ≥10 商品有 price + 106.55 上 monitor_data/series.json 更新。
- [ ] Step 6 62.112 crontab 装 daily/weekly 两条(核对时区换算 WIB 03:00)。
- [ ] Step 7 本地提交 browser.js + deploy 脚本修改,推送。
