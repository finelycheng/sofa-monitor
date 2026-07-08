# 竞品监控系统 · 设计文档

日期:2026-07-07 · 状态:已获用户批准(§1-§3 分节确认)

## 1. 目标与范围

无人值守的印尼沙发竞品监控:每日抓取 Tokopedia 公开数据,差分出竞品动销/价格/SKU/库存动作,自动高亮"本周要点",以静态 dashboard 呈现在 sofa.wefishing.cn。

**明确不做**:Shopee 日常抓取(登录态+验证码,无法无人值守;需要时在交互 session 里人工补)、推送通知(用户选了仅 dashboard)、数据库(文件足够)。

## 2. 已确认的决策(用户逐项批准)

| 决策点 | 结论 |
|---|---|
| 运行方式 | 全自动·服务器端(106.55.199.206,CentOS 7)|
| 监控对象 | 两层:关键词榜单(6词×Top20,发现变化)+ 固定竞品清单(~15品,解释变化),新玩家从榜单晋升候选 |
| 输出 | 仅静态 Dashboard,挂工具台;无推送 |
| 频率 | 每日抓取(WIB 凌晨3点/北京4点),周视图聚合;评论扫描每周一 |
| 架构 | 方案一:服务器 Docker(Playwright 官方镜像)+ 宿主 cron;CentOS 7 glibc 太老必须容器化;Docker 装不上则退 GitHub Actions |

## 3. 监控指标(全部已批准)

**每日核心**:价格异动≥5% · 销量跳桶 · 评分人数加速(周增>4周均值×1.5)· 新玩家入榜(Top10)· 排名异动≥5位 · 连续2天抓取失败 · **库存差分=精确日销**(有 Stok 显示的商品;上跳=补货事件)· 折扣深度 · 变体增减 · 店铺上新(店铺页商品列表 diff)· 发货地变更

**每周批处理**:差评关键词计数(sobek/kempes/tidak mengembang/lama/beda warna/tidak sesuai)

**每日派生**(从榜单快照免费计算):关键词价格带漂移(Top20 中位/最低价,dashboard 以周曲线展示)

**环境层**:IDR/CNY 汇率(变动>3%高亮)· 大促日历标注(7.7/9.9/11.11/12.12/每月25发薪周/斋月倒计时)

**明确砍掉**(YAGNI):Diskusi 提问数、头部集中度、跨境卖家占比。

## 4. 架构

```
cron(宿主) ─每日04:00京─→ docker run monitor daily
           ─周一04:30京─→ docker run monitor weekly
容器内: 抓取(keyword/product/shop/fx[/reviews]) → snapshots/YYYY-MM-DD.json(只追加)
       → analyze.js(纯函数): series.json 增量 + highlights.json
       → render.js: competitor-monitor.html + monitor_data/*.json
       → cp 到 /usr/share/nginx/html/
```

- 源码 home:本地 `/Users/czq/sofa/monitor/`;部署 = rsync 到服务器 `/home/monitor/`
- 数据量:~150KB/天;无数据库
- nginx:`location = /competitor-monitor.html` + `location ^~ /monitor_data/`(照现有模式,改配置先备份+nginx -t)
- 工具台 home.html 加入口卡片

## 5. 组件

### 5.1 monitor.config.json(唯一配置源)
keywords(6词/topN)· products(~15条:url/label/primaryKeyword/trackStock)· shops(~8家)· thresholds(priceChangePct:5, rankShift:5, ratingCountAccel:1.5, fxChangePct:3, missingDays:2)· negativeKeywords · campaignCalendar。加减竞品=改配置不碰代码。

初始清单:NusaHome、MeeXi(2链接)、INTHEBOX、Quantum、TURU、Mee-DO、furlaindah、PUJA、TETE、Z furniture、Nala Argani、cutehome、Goto Zila 等,按选品作战板 P1-P9 对标关系配齐。

### 5.2 抓取模块(共用一个浏览器实例)
- keyword.js:搜索页滚动加载 TopN → rank/title/url/price/soldLabel/rating/shop/发货地
- product.js:商品页 → price/划线价/soldLabel/rating/**ratingCount(精确)**/**stock**/变体列表/发货地/在售状态
- shop.js:店铺页商品列表 → url 集合(diff 上新)
- fx.js:免费汇率 API → IDR/CNY
- reviews.js(weekly):清单竞品低星过滤 → 新增低星数+负面关键词计数

节奏:页间随机 8-20s,不并发,总时长~15min,普通桌面 UA,无登录态。

### 5.3 analyze.js(纯函数)
今日快照+历史 series → series 追加点、派生指标(stock差分日销/restock事件、折扣深度、变体diff、上新diff、价格带中位、评分增速)、highlights.json(`{级别,图标,一句话,证据链接,数据}`)。

### 5.4 Dashboard(货柜作战板同款设计语言,全自包含无外部依赖)
① 本周要点(highlights 按级别)② 竞品清单大表(15行:现价/折扣/桶/评分周增/库存日销sparkline/排名)③ 关键词战场(Top20变化+🆕+中位价周曲线)④ 弱点雷达(差评关键词趋势,按竞品分组)⑤ 环境条(汇率+大促窗口+数据健康度)。

## 6. 错误处理(宁缺毋假)

- 单页失败:重试×2(30s),仍败记 null,不阻塞
- 选择器失效:模块级最低字段校验不过 → 标 degraded,dashboard 黄条
- 整跑失败:外层捕获 → logs/FAILED-日期;连续2天页面顶部红条
- 汇率挂:沿用前值标 stale
- 防污染:快照只追加;series 更新前 .bak;渲染失败不覆盖旧 html
- 下架:连续2天404 → 高亮"疑似下架"(本身是情报)
- 反爬自保:遇验证/跳转页当日放弃剩余并标记,绝不重试轰炸

## 7. 测试与验收

- 解析器单测:真实页面 HTML 存 fixtures/,断言字段(改版即更新 fixture 回归)
- 差分引擎单测:两日假快照,断言跳桶/价格异动/上新/restock/评分加速
- 冒烟:`node run.js daily --dry-run`(1词+2品)人眼验收
- 部署验收:服务器手动跑一次全量 → 页面上线、健康区全绿;连跑3天人工核对差分 vs 手查
- **Done 定义**:连续7天无人工干预日更;高亮命中≥1次真实事件;每周要点≤10条(无误报泛滥)

## 8. 风险与备选

| 风险 | 应对 |
|---|---|
| CentOS 7 装不上 Docker | 退方案二:GitHub Actions 跑抓取,rsync 回服务器展示(需先建私有 repo) |
| Tokopedia 加强反爬 | 低频温和策略打底;若封 IP,考虑抓取错峰/降频到每2天 |
| 页面改版 | fixtures 回归 + degraded 标记,修复窗口内 dashboard 明示数据缺口 |
| 库存字段消失(平台隐藏) | stock 差分自动降级为跳桶+评分增速双信号,dashboard 标注 |
