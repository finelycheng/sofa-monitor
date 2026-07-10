# 头部店铺全量画像监控 · 设计文档

日期:2026-07-09 · 状态:已获用户批准(§1-§3 分节确认)

## 1. 目标与范围

监控 5 家头部沙发店铺的全量画像,纳入每日追踪:每店销量前 20 的产品(店铺名/产品名/图/链接/销量/评分/评论数/差评关键词),加每周最近 50 条评论原文。追踪上新/下架/销量涨跌/差评增长等变化。

**是现有竞品监控系统(`monitor/`)的孪生扩展**,复用其全部防御性基础设施,独立错峰跑,与现有轻量 daily 完全解耦。

**明确不做**:全量评论每日抓(海量,不现实,评论原文降为每周);产品图下载(存 CDN URL,每日刷新);无销量产品(店铺页销量排序自动跳过)。

## 2. 已确认决策(用户逐项批准)

| 决策点 | 结论 |
|---|---|
| 一次性 vs 持续 | 持续,纳入每日监控(方案B) |
| 产品范围 | 每店销量前 20,无销量忽略 |
| 评论粒度 | 聚合指标(评分/评论数/低星关键词)+ 最近 50 条原文 |
| 评论频率 | **聚合每日 / 50条原文每周**(方案一,砍机器负载80%) |
| 店铺(5家) | MeeXi, NusaHome, INTHEBOX, Quantum, TURU(全沙发,覆盖压缩床/三折/2in1) |
| 架构 | 独立模块,不动现有 daily;新增第三/第四个 cron 错峰 |
| 产品图 | 存 URL(每日刷新,dashboard 只展示最新快照) |

## 3. 架构与数据流

```
现有 cron: daily 03:00 / weekly 周日03:30  ← 不动
新增 cron:
  shop-daily  05:00 每天 → 5店×top20 聚合指标(~100页,~40min)
  shop-weekly 周日05:30 → 每产品最近50条评论原文(~100页×滚动,~1.5h)
      ↓
新增文件:
  monitor/shop-run.js              CLI: shop-daily | shop-weekly [--dry-run]
  monitor/scrape/shopProfile.js    店铺页按销量取top20 + 每产品聚合
  monitor/scrape/productReviews.js 单产品最近50条评论原文(weekly)
  monitor/analyze-shops.js         店铺 series 差分 + 变化高亮
  monitor.config.json 扩展: shopProfiles=[5家]
      ↓
数据(只追加):
  data/shops/<shopid>.json          每日聚合时序
  data/shop-reviews/<productid>.json 每周50条评论原文
      ↓
  渲染 shop-profiles.html + shop_data/*.json → scp 106.55
      ↓
  sofa.wefishing.cn/shop-profiles.html(工具台加入口)
```

**复用现有**:browser.js(headed+单context+withTimeout)、lib/parse.js、lib/io.js(只追加+.bak+原子写)、部署管道(base64同步/scp发布)。

**店铺页销量排序**:Tokopedia 店铺页 "Paling Laku"(最畅销)排序 URL,取前 20 有销量产品。
**每产品聚合**:复用 extractProduct + 评论区低星关键词计数(现有 weekly 能力)。

## 4. 数据结构

`data/shops/<shopid>.json`:
```
{ shop:"meexistore", shopName:"MeeXi",
  snapshots:[ { date:"2026-07-10", products:[
    { rank, productId, name, imageUrl, url, soldBucket, soldValue,
      rating, ratingCount, negKw:{sobek,kempes,beda_warna,tidak_mengembang,lama,tidak_sesuai} }
    ...top20 ] } ] }
```
`data/shop-reviews/<productid>.json`:
```
{ productId, name, weeks:[ { week:"2026-W28",
    reviews:[ {rating, text, variant, timeAgo}, ...最近50 ] } ] }
```

**变化追踪(差分,每店对比昨天)**:✨上新(新进top20)· 📉掉榜/疑似下架 · 📈销量跳桶 · ⭐评分数加速 · 🗣️差评词增长。

## 5. Dashboard(shop-profiles.html)

- 5 店分区,每店顶部"本周变化"行(上新/掉榜/爆品)
- 每店 top20 产品表:产品图缩略 + 名 + 链接→ + 销量桶 + 评分(评分数周增) + 差评词计数
- 点产品行展开最近 50 条评论(读 shop-reviews json)
- 货柜作战板设计语言,自包含无外部依赖,空态健壮

## 6. 错误处理与负载

- 错峰:shop-daily 05:00(现有daily 03:20 跑完后)、shop-weekly 周日05:30
- 每店处理完落一次盘(部分成功留数据);外层 cron 包 timeout(daily 90min/weekly 150min)兜底
- 单产品失败→记error跳过不阻塞;某店整体失败→保留上次快照+dashboard标"滞后N天";top20不足→有几个抓几个;blocked→当店放弃当日剩余+标记,绝不重试
- 快照只追加、series .bak、发布"产物存在才覆盖"(全继承主系统)

## 7. 测试与验收

- 解析器:店铺销量排序页 + 产品评论页 fixtures,断言 top20 提取、评论原文提取
- 差分引擎:两日假快照,断言上新/掉榜/跳桶/差评增长(纯函数)
- 冒烟:`shop-run.js shop-daily --dry-run`(1店×3产品)人眼验收
- **Done**:shop-daily 连跑3天无干预、5店各出top20;次日起变化追踪出现;shop-weekly 出每产品50条评论;dashboard 5店画像可访问、图正常、点产品看评论

## 8. 风险

| 风险 | 应对 |
|---|---|
| 5店重任务压垮2G机器 | 独立错峰05:00、单浏览器每页新context、外层timeout兜底、每店落盘 |
| 店铺页销量排序URL/结构变 | fixtures回归 + degraded标记 |
| 评论50条滚动加载慢/被拦 | withTimeout硬超时;blocked熔断;每周跑压力小 |
| 图URL签名过期 | 每日刷新,dashboard只用最新快照;历史图裂可接受 |
