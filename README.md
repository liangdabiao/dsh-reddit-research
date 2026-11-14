# Reddit 调研台 · dsh-reddit-research

DeepSeek Harness（[dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)）插件：从 subreddit 抓取真实用户讨论（Arctic Shift 免认证档案 API），输出痛点评分卡、商业信号（购买/付费/流失/退货）、竞品口碑与选品/进入决策报告——**全部结论带原帖链接可复算**。

方法论与上游脚本源自 [reddit-research](https://github.com/liangdabiao/reddit-research)（Python 全量重写为 Node 原生，**零 Python 依赖**；上游 Python 脚本升级为 `reddit_research` 工具的 action，分析管线逐条对齐）。


<img width="1455" height="573" alt="image" src="https://github.com/user-attachments/assets/53b6d391-c20f-4936-b4ba-38e59c971c40" />
<img width="1317" height="669" alt="image" src="https://github.com/user-attachments/assets/c0367dcc-645d-497a-b720-e57d92d2c432" />


## 装上以后有什么

| 能力 | 说明 |
|---|---|
| `reddit_research` 工具（12 个 action） | `probe` 探活估样本量 · `create` 建调研 · `fetch` 全量拉取（断点续传）· `themes` 主题表 · `analyze` 五分类+评分卡 · `comments` 评论树补刀 · `report` 存报告 · `verify` 数字闭环 · `read`/`list`/`delete` |
| 🌏 **海外动态栏目**（v0.2.0） | 16 个精选 Reddit 社区（创业·SaaS / 营销·SEO / 应用·AI 开发，含月访问量参考）：面板分类筛选 + 社区卡 + 最新帖流（score/评论/作者/原帖链接），「加载更多」按 before 游标续拉；工具 `action=feed` 同源 |
| 侧栏「Reddit 调研台」面板 | 调研库卡片（闭环状态标记）/ 数据构成 / 五分类 + 数据体检（Top30 展示帖占比、scope 相关性、KOC 软文）/ 痛点评分卡（趋势箭头）/ 商业信号 / 评论级分析 / 报告全文 / 时间线；探活·拉取·分析·补刀·校验直调 |
| 可靠性（上游实测纪律内置） | 422 "Timeout" = 瞬态过载退避重试（同参重发即恢复）；全站关键词查询 400 = 形态不允许不重试；空响应重试 3 次；防卡死（连续 3 页 0 新帖终止）；增量落盘 .jsonl + 原子合并，**中断后重跑同一命令即续传** |

## 七步流程（每步都有上游实测教训背书）

```
probe 探活 + 自动定窗（单次 ≤20 页，超了按日均自动缩窗，不打断用户确认）
  → fetch 全量拉取（关键词搜索过载敏感且品牌名几乎不在标题——全量+本地过滤是主路径）
  → themes 主题表（按品类重建；短词必须 \b 词边界，否则主题频次整体虚高）
  → analyze 标题级五分类（抱怨/求助/展示/称赞/其他；判据放标题级防晒作品帖霸榜
     —— 实测全文判据 2819 帖 → 标题级 847 帖）+ 痛点评分卡（普遍度50×严重度30×趋势20）
     + 数据体检（Top30 展示帖占比 >50% = 情感展示型；scope 相关性 <30% 先修数据）
  → comments 评论树补刀（只抓痛点层候选，禁止对全局热度 top 抓评论——那是展示帖）
  → report 按固定格式写报告（每条结论附原帖链接；数据不足写「需补调研：X」禁止凑数）
  → verify 数字闭环（ID/score/comments/日期逐条回查数据集，编造引用=报告无效）
```

## KOC 软文（电商/美妆类必读）

r/Wigs 这类晒单强制带购买链接的社区，品牌方与 KOC 直接伪装用户发帖——**被剔除的恰好是分数最高的"正面评价"**（上游实测 Luvme 298 分、Unice 136 分全是软文）。`analyze` 时传 `promoCheck=true` 开启检测。但**不要跨品类沿用假设**：潮玩实测软文仅 0.2%。每个品类独立实测。

## 使用

对话里直接说：

- 「调研一下 r/esp32 最近在抱怨什么」——probe 报页数 → 确认 → fetch → themes → analyze → 痛点清单
- 「假发品类值不值得做」——深度流程（先读 skills/reddit-research/references/deep_research_10_modules.md 的商业决策 7 模块），出 B1–B7 报告 + SEO 附录包
- 「r/xxx 的用户怎么看这个品牌」——scope 正则 + promoCheck + 评论级口碑矩阵

或打开侧栏「Reddit 调研台」：点右上「＋ 发起调研」填调研名 / 研究问题 / subs / 时间窗，会开一个新对话并把完整指令填进草稿（不自动发送）；调研详情页可直调探活 / 拉取 / 分析 / 评论补刀 / 校验闭环，并看数据构成、评分卡、报告与闭环状态。

## 开发

```bash
npm i
npm test           # 16 个单测（五分类判据/词边界/评分卡/趋势/商业信号/KOC/422 重试/断点续传/闭环三查/全链）
npm run smoke      # 离线冒烟：假 Arctic Shift 服务器 + 工具直调 + 面板 API 全路由
npm run live       # 真实 API 全链：probe→fetch→analyze→comments→verify（esp32 3 天 ≈ 30s）
npm run dev        # 面板独立预览：DSH_HOME=<目录> node scripts/devserver.mjs 5188
```

数据落在 `$DSH_HOME/reddit-research/<调研名>/`：`data/<sub>.json`（+.jsonl/.meta/.log）+ `themes.json` + `analysis.md` + `comments.md` + `report.md` + `journal.jsonl`，原子写。

> ✅ 2026-11-13 实测：真实 API 全链 28 秒（r/esp32 3 天 84 帖 → 评分卡 Top1 开发环境 70 分 → 33 条干净评论 → 闭环通过）。

## 结构

```
src/host.js            reddit_research 工具（11 action）+ 装配
lib/reddit.js          Arctic Shift 客户端（probe/fetch 分页+断点/comment_tree/ids 批量；422 退避/400 快败/空响应重试/防卡死）
lib/analyze.js         标题级五分类 + 主题表 + 趋势 + 痛点评分卡 + 商业信号 + 数据体检 + KOC 检测（analyze_title_level.py 移植）
lib/comments.js        评论级分析（analyze_comments.py 移植；剔 [removed]/机器人）
lib/verify.js          数字闭环校验器（verify_citations.py 移植：ID/score/comments/日期三查）
lib/store.js / ops.js  $DSH_HOME/reddit-research/<study>/ 持久化 + 工具/面板共用业务层
lib/api.js             /reddit-research 面板路由（白名单文件 + 直调）
client.js / lab/       浏览器半边（侧栏入口 + iframe 面板，明暗跟随 dsh 主题）
skills/reddit-research/ 方法论技能（references/ 保留上游 api_endpoints + deep_research_10_modules 全文）
```

## 合规与边界

定位：个人/一次性市场与产品研究。Arctic Shift 为未经 Reddit 明确授权的社区档案，此类使用通常被默许但无任何保证。**禁止**做成对外产品功能、用于 AI 模型训练（Reddit 2024+ ToS 明令禁止）、转售数据。**只读**：本插件不含任何发帖/评论/点赞自动化。公开引用保留原帖链接与作者名。


## 16个值得关注的Reddit社区

1.r/saas月访问量110万+
SaaS产品、创业经验、产品增长

2.r/founder 月访问量21.6万+创始人交流、创业经验、商业增长

3.r/sideproject-月访问量130万+
副业项目、独立开发、产品展示

4.r/agency月访问量1.4万+营销代理、客户开发、Agency运营

5.r/macapps月访问量57.6万+Mac应用、软件推荐、产品反馈

6.r/vibecoding月访问量140万+AI编程、Vibe Coding、AI产品开发

7.r/bigseo月访问量2万+
Google SEO、搜索引擎优化、技术交流

8.r/marketing月访问量27.2万+数字营销、品牌推广、增长策略

9.r/blogging月访问量1.4万+博客运营、内容营销、流量增长

10.r/microsaas月访问量6.8万+微型SaaS、独立开发、产品变现

11.r/entrepreneur月访问量74.4万+创业经验、商业模式、企业经营

12.r/imadethis月访问量10.4万+创意作品、产品展示、用户反馈

13.r/juststart月访问量1.4万+内容网站、SEO实践、网站变现

14.r/micro_saas月访问量18万+
微型SaaS、产品增长、独立创业

15.r/startups月访问量30.8万+
初创企业、融资、产品冷启动

16.r/apps月访问量14万+
App推荐、应用发现、产品讨论

## License

MIT（本插件代码）。方法论与上游脚本参考 liangdabiao/reddit-research；Arctic Shift API 使用受其服务条款约束。


## 特别致谢

https://linux.do 社区支持

Arctic Shift API 免费提供数据
