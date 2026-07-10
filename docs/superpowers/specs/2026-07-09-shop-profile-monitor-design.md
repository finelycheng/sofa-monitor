# 头部店铺全量画像监控 · 设计文档

日期:2026-07-09 · 状态:已获用户批准(§1-§3 分节确认)

## 1. 目标与范围

监控 5 家头部沙发店铺的全量画像 + **竞品打法情报**。两层价值:
- **数据层**:每店销量前 20 产品的结构化追踪(名/图/链接/销量/评分/评论数/差评词),追踪上新/下架/销量涨跌/差评增长。
- **情报层**:每周用 LLM 从原始数据(标题全文/描述/变体/信任要素/50条评论)提炼每个产品的**「打法画像卡」**——主打卖点/定价策略/目标人群/差异化点/效果评级/弱点(可狙击点)/一句话打法总结。从"看它卖了多少"升级到"看它怎么打的、怎么狙击它"。

**是现有竞品监控系统(`monitor/`)的孪生扩展**,复用其全部防御性基础设施,独立错峰跑,与现有轻量 daily 完全解耦。

**明确不做**:全量评论每日抓(海量,评论原文降为每周);产品图下载(存 CDN URL,每日刷新);无销量产品(销量排序自动跳过);打法画像每日生成(降为每周 LLM 一次,省算力)。

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
| **打法画像六维度** | 全要:①主打卖点 ②定价打法 ③SKU/变体策略 ④信任转化要素 ⑤视觉打法 ⑥流量打法 |
| **打法画像频率** | 每周 LLM 提炼一次(跟 shop-weekly 评论抓取同批) |
| **LLM 落地** | DeepSeek API 全自动(定):VPS shop-weekly 抓完逐产品调 deepseek-chat 生成画像卡,并入 dashboard。key 存 VPS 环境变量(**不进 git**)。 |

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

## 3.5 采集字段补充 + 打法画像分析层

**采集层补抓(每日,支撑六维度)**——产品详情页多抓这些原始字段进快照:
- `titleFull` 标题全文(→卖点①/流量⑥:SEO词堆砌)
- `description` 详情描述文本(→卖点①/人群定位)
- `mainImages` 主图URL数组(→视觉打法⑤:场景/白底/信息图判断)
- `variants` 完整变体矩阵(已抓,→SKU策略③)
- `originalPrice`/`price`/`discount` 价格(已抓,→定价打法②)
- `trust`:{cod, cicil分期, freeOngkir免运, garansi保证, shopTier店铺等级, origin发货地, shipEta发货时效}(→信任转化④)

**分析层(每周 LLM,跟 shop-weekly 同批)**——对每产品,喂入上述原始字段 + 最近50条评论,LLM 输出「打法画像卡」JSON:
```
{ productId, week,
  卖点: "真空压缩+D23密度+可拆洗(标题堆12个SEO词)",
  定价: "Rp1.22jt,划线1.9jt伪折扣36%,变体做低价引流",
  人群: "小户型/租房青年(标题带 anak kos/ruang sempit)",
  差异化: "密度写进标题建立信任,vs竞品只说'empuk'",
  效果: "★★★★☆ 月销2rb+评分4.9动销快,但差评塌陷在涨",
  弱点: "kempes(塌陷)差评周增,vacuum库存过期致不回弹",
  狙击点: "你可用D28+7天不回弹包换正面打它的塌陷软肋",
  总结: "SEO+密度信任+伪折扣的性价比打法,弱在耐久" }
```

**LLM 落地(定:DeepSeek API 全自动)**:
- 新增 `monitor/scrape/playbookAnalyzer.js`:输入每产品的 titleFull/description/variants/trust/最近50评论,调 **DeepSeek `deepseek-chat`**(OpenAI 兼容,endpoint `https://api.deepseek.com/chat/completions`),用固定 prompt 输出画像卡 JSON(卖点/定价/人群/差异化/效果/弱点/狙击点/总结)。
- 由 shop-weekly 在评论抓完后逐产品调用(~100 次/周,DeepSeek 极便宜);结果写 `data/shop-cards/<week>.json`,并入发布产物。
- **API key 存 VPS 环境变量 `DEEPSEEK_API_KEY`(写入 VPS 的 gitignore 文件如 `/home/monitor/.env`,run 脚本 source 它;绝不硬编码进代码、绝不进 git/GitHub)**。
- prompt + 画像卡 schema 在 plan 里固化;LLM 输出用 JSON mode + 校验,失败重试1次,再失败该产品画像标 null(不阻塞其他)。
- 健壮性:DeepSeek 调用包超时(30s)+ 失败降级(画像缺失不影响结构化数据展示)。

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
- **点产品行展开「打法画像卡」**(卖点/定价/人群/差异化/效果/弱点/狙击点/总结)+ 最近 50 条评论
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
