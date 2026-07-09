# CLAUDE.md — 印尼沙发出海项目

崇阳（湖北）实木/布艺沙发 → 印尼跨境出海。本仓库汇总选品调研、成本定价、操盘手册、线上工具与考察准备。

## 成本模型（核心数字）

| 项 | 值 |
|---|---|
| 工厂出货 | 400 元/柜（单位成本口径） |
| FOB | 420 |
| 海运 | ~1w/柜 |
| 双清包税 | ~3w/柜 |
| 关税 | Form E → 0（中国-东盟原产地证） |
| HS 编码 | 9401.61.00（布面软体沙发），核对清单见 `reference/` |

数据来源规则：抓印尼沙发行情走 **Tokopedia**（网页版 TikTok Shop 账号是美国区，抓不到印尼数据）。虚拟滚动 + 完整 URL + 签名图当场下载。

## 目录结构

```
tools/            交互式 Web 工具(成本计算器/考察清单/工具台首页/选品作战板+its images)
market-data/      各平台竞品采集报告 — 每个子目录 = 报告HTML + JSON数据 + 采集脚本 + 图片
  ├─ shopee-live-top50/       Shopee 实时销量 Top50(已上线)
  ├─ shopee-sales-top50/      Shopee 累计销量 Top50
  ├─ tokopedia-fabric-top50/  Tokopedia 布艺沙发 Top50
  └─ tiktok-top20/            TikTok Shop 沙发 Top20(base64自包含,已上线)
seller-journey/   Tokopedia & TikTok Shop 卖家成长旅程执行文档(md源 + html,已上线)
research/         调研与操盘手册(见下)
reference/        参考资料 — HS核对清单PDF/雅加达家具城docx/IKEA样品图/旧竞品图
medusa/           DTC 独立站技术验证(Medusa demo-store)
archive/          duplicates=重复文件 / legacy-report=旧报告生成器(final20+gen_report+sofa_images)
```

### research/ 要点
- `indonesia_sofa_playbook.md` — 操盘手册主文档，8 章节（海外仓/清关/PTPMA注册/开店资格/尾程/收款税务/平台/市场）+ 1 柜试水 MVP + 雅加达考察行程。有 `.pdf` / `.docx` 导出。
- `ID_Sofa_Competitor_Research_2026-07-03.md` — 竞品调研。
- `next_actions/` — 编号执行清单（数据订阅/TikTok开店/爆品拆解/万隆工厂RFQ/KOL打法）。
- 子专题目录：`factory_strategy` `india_vs_indonesia` `indonesia_dtc_platform` `indonesia_market_entry` `indonesia_trip` `medusa_indonesia_tech`。
- `ppt/` — 调研/行动手册的 PPTX 成品与生成脚本。

## 线上部署（sofa.wefishing.cn）

服务器 `106.55.199.206`（ssh root，端口22）。⚠️ **不是纯静态站**：`/etc/nginx/conf.d/sofa.conf` 的 `location /` 兜底代理到 :3000 的 Next.js 商店（领盟家居 Lingmeng），`/app|admin|store|auth|hooks` 代理到 :9000（Medusa）。IP 直访是另一个站（/home/czq/dist），gold.wefishing.cn 也在这台机（/home/gold），都别动。

**发布新静态页 = 两步，缺一不可**：
1. scp 文件到 `/usr/share/nginx/html`（图片目录连同引用它的 HTML 一起传）
2. 在 `sofa.conf` 加精确匹配块（页面 `location = /xxx.html`，图片目录 `location ^~ /xxx_images/`，照抄已有块），`nginx -t && systemctl reload nginx`。改前先备份：`cp sofa.conf sofa.conf.bak.$(date +%Y%m%d%H%M%S)`

只更新已发布页面内容 → 仅需 scp 覆盖。首页 `home.html` 用**绝对路径** `/xxx.html` 链接。

本地文件 → 服务器根路径映射（均已有 location 块）：

| 本地路径 | 服务器路径 |
|---|---|
| `tools/home.html` | `/home.html`（工具台入口） |
| `tools/cost-pricing.html` | `/cost-pricing.html` |
| `tools/indo-checklist.html` | `/indo-checklist.html` |
| `tools/sofa-product-picks.html` + `tools/sofa_picks_images/` | `/sofa-product-picks.html` + `/sofa_picks_images/` |
| `tools/shipping-mark.html` | `/shipping-mark.html`(箱唛生成器) |
| `monitor/dashboard/competitor-monitor.html` | `/competitor-monitor.html`(竞品监控,数据在 `/monitor_data/`) |
| `market-data/tiktok-top20/tiktok-id-sofa-top20.html` | `/tiktok-id-sofa-top20.html` |
| `seller-journey/tiktok_indonesia_seller_growth_journey_cn.html` | `/tiktok_indonesia_seller_growth_journey_cn.html` |
| `market-data/shopee-live-top50/shopee-indonesia-sofa-live-top50.html` | `/shopee-indonesia-sofa-live-top50.html` |
| `market-data/shopee-live-top50/shopee_live_sofa_images/` | `/shopee_live_sofa_images/` |

> ⚠️ 采集报告 HTML **按相对路径**引用同级图片目录（如 `shopee_live_sofa_images/`），移动报告时必须连同图片目录一起移动；部署上线的报告要连图片目录一起 scp。

## 约定
- 每个采集任务：报告HTML / JSON / 采集脚本 / 图片目录 四件套放同一 `market-data/<平台>` 子目录。
- 生成新工具页想上线，把文件 scp 到 nginx 根并在此表登记映射。

## 竞品监控系统(monitor/)

无人值守的 Tokopedia 竞品每日监控。设计/计划在 `docs/superpowers/specs|plans/2026-07-07-competitor-monitor*`。

**架构(两台机)**:
- **抓取主机 62.112.138.227**(海外VPS,SSH 端口 **30022**,root)：Docker 跑 headed chromium+Xvfb 抓取,数据真源在 `/home/monitor/data`(快照只追加)。cron 每天 **UTC 20:00 = 雅加达 WIB 03:00** 跑 daily,周日 20:30 跑 weekly。
- **展示主机 106.55**(sofa.wefishing.cn)：只接收产物。抓取主机跑完 scp `competitor-monitor.html` + `monitor_data/*.json` 到 nginx 根。

**为什么用海外VPS**:大陆机器(106.55腾讯云)对 Tokopedia 应用层黑洞;headless chromium 被 Akamai TLS 指纹拦(ERR_HTTP2),必须 **headed chromium + Xvfb**(实测)。

**运维要点(血泪)**:
- 62.112 是 1核机,内存**必须 ≥2G**(961M 跑 headed chromium 抓 Tokopedia 重页面随机 OOM,压垮过整机)。云厂商改内存要 **Stop→Start 完整停开机**才生效(Reboot 不行)。
- 该机网络从大陆抖动严重、偶发全网失联(它也是 xray 节点)。发布脚本有重试 + "产物存在才覆盖",失联丢一天下次自动补,不会白屏。
- 改监控对象=改 `monitor/monitor.config.json`(15竞品/8店铺/6关键词/阈值)后 rsync 到 62.112:/home/monitor。
- 排障:62.112 的 `/home/monitor/data/logs/`;本地 `cd monitor && npm test`(20 测试)。
- 代码修复史沉淀在 `monitor/lib/browser.js` 注释(HARDEN_ARGS 内存参数、每页新context)和 `monitor/deploy/`(手动Xvfb 而非 xvfb-run)。

**首次验证达标**(2026-07-09):6/6 关键词有数据、13/15 商品有价、内存峰值 ~800MB。首日 highlights 为空正常(变化规则需次日基线)。
