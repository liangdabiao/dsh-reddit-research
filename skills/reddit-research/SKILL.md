---
name: reddit-research
description: Reddit 深度调研方法论：从 subreddit 抓取真实用户讨论（Arctic Shift 免认证），输出痛点评分卡、商业信号（购买/付费/流失/退货）、竞品口碑与选品/进入决策报告，全部结论带原帖链接可复算。用户说"调研 reddit"、"r/xxx 在聊什么"、"reddit 用户怎么看 xxx"、"某品类值不值得做"、"选品/竞品分析"时使用。只读采集，不含发帖/评论自动化。触发词：reddit 调研、reddit 口碑、reddit 选品、reddit 痛点、subreddit 分析。
---

# Reddit 调研

## Overview

通过 Arctic Shift 档案 API（免认证）抓取 subreddit 帖子与评论树，做商业机会分析：痛点提取与评分排序、购买/付费/流失信号统计、竞品口碑矩阵、选品决策结论。所有结论必须附 Reddit 原帖链接。

**核心原则：读 Reddit 数据走 Arctic Shift，不要直连 reddit.com 抓取（匿名 .json 已封 403）。**

## 工具映射（dsh 版）

上游 Python 脚本已全部内置为 `reddit_research` 工具的 action：

| 上游脚本 | dsh action |
|---|---|
| `probe_subreddit.py` | `action="probe"`（探活 + 近 N 天精确帖量 + 页数预估） |
| `fetch_subreddit.py` | `action="fetch"`（分页全量拉取 + 增量落盘 + 断点续传 + 422 退避） |
| `analyze_title_level.py` | `action="themes"`（存主题表）+ `action="analyze"`（五分类/评分卡/商业信号/数据体检） |
| `comment_tree.py` + `analyze_comments.py` | `action="comments"`（痛点层补刀 + 评论级分析，自动剔 [removed]/机器人） |
| `verify_citations.py` | `action="verify"`（数字闭环：ID/score/comments/日期逐条回查数据集） |

**海外动态（v0.2.0）**：`action="feed"` 拉 16 个精选社区（创业·SaaS / 营销·SEO / 应用·AI 开发）最新帖流——不传 subs 列目录，`subs="saas"` 单社区（`limit` ≤100），多社区各拉一页混排。面板侧栏「海外动态」栏目可分类筛选、看帖流、「加载更多」按 before 游标续拉。数据只读、滞后约 36h。

数据落 `$DSH_HOME/reddit-research/<调研名>/`：`data/<sub>.json(+.jsonl/.meta/.log)` + `themes.json` + `analysis.md` + `comments.md` + `report.md`。面板（侧栏「Reddit 调研台」）可看数据构成/五分类/评分卡/商业信号/报告与闭环状态，并提供探活/拉取/分析/校验直调。

## 工作流决策

| 需求 | 走哪条 |
|---|---|
| "r/xxx 最近在聊什么"、"用户主要抱怨什么" | 轻量流程：probe → fetch → themes → analyze，出痛点清单 |
| 商业机会 / 选品 / 竞品 / 品牌 / 产品反馈 / 口碑 | 深度流程：先读 `references/deep_research_10_modules.md`（商业决策 7 模块 B1–B7），采集手段相同 |

## 标准工作流（七步，缺一不可）

### 1. 界定研究问题 + 探活定窗

先用三行字钉死调研：品类/产品、要回答的决策问题、目标用户。**没有研究问题，后面所有筛选没有准绳。**

`reddit_research(action="create", name=..., question=..., subs="esp32,arduino", days=90)` → `action="probe"` 拿近 N 天精确帖量与页数。

**窗口由 probe 定，不要把页数抛给用户拍板**：probe 回执自带「窗口建议」并写回调研（`project.json.days`），直接 `action="fetch"` 即可。

- 页数预算：单次 fetch ≤ **20 页**（1 页 = 100 帖 ≈ 0.75 秒；20 页 ≈ 2000 帖 ≈ 1.5 分钟串行）
- 超预算 → probe 按同一份日均数据自动缩窗（下限 7 天）并说明缩了多少；**照建议值拉，不要回头问用户**
- 没超预算 → 别为「跑得更快」再砍窗口，样本越全结论越稳
- 只有用户明确说「要拉满 N 年 / 全量」时才照用户的窗口跑，并先回报预计页数与耗时
- 近 N 天 0 帖或日均 <1 帖的 sub **不可用于结论**（换 sub，或报告里写「需补调研」）

### 2. 全量拉取

`action="fetch"`（多 sub 各自独立输出与日志；单 sub 分页串行；中断/网络失败后**重跑同一命令即续传**，已抓数据不丢；`fresh=true` 从头重抓）。

### 3. 主题表（按品类重建）

`action="themes", themes='{"电源/电池": "batter|charg|power|\\b5v\\b", ...}'`

- 模板 `assets/themes_esp32.json`（硬件域）/ `assets/themes_llm.json`（AI 域）只参考结构
- **短词必须加 `\b` 词边界**：ap/log/ram/can/pin/doc/ota/ble 裸写会命中 app/happy/program/shipping/docker/rotation/available，主题频次整体虚高
- 用深度文档的「开放式主题归纳」让 AI 对照数据校准主题表（AI 找全、正则数对）
- 同时登记 `scope` 正则（品类关键词）——数据体检与评论树候选过滤共用

### 4. 帖级分析

`action="analyze"`（`promoCheck` 见下）。产出五分类 + 主题频次（带趋势列）+ 痛点评分卡（普遍度50×严重度30×趋势20）+ 帖级商业信号 + 数据体检（sub 构成 / scope 相关性占比）。

**必看两个占比**：
- **Top30 高互动帖展示帖占比** >50% = 情感展示型，痛点必须关键词定向挖掘，不能靠热度排序（否则得出"口碑极好、无痛点"的反向结论——潮玩实测 86.7%）
- **scope 相关性** <30% = 数据混入大量无关 sub/话题，先修数据再写报告

**KOC 软文**：电商/美妆/假发类开 `promoCheck=true`（被剔除的恰好是分数最高的"正面评价"，不剔除结论完全相反）；潮玩实测仅 0.2% 不必开——**每个品类独立实测，不跨品类沿用假设**。

### 5. 评论树补刀

`action="comments"`（候选自动来自痛点/口碑层 top，非全局热度 top；可 `ids` 显式指定）。

**禁止对全局热度 top 抓评论**——那大概率是展示帖，评论只会是 "Awesome!"。评论自动剔除 [removed]/机器人。评论级主题频次 = "多少人共鸣"，与帖子级"多少人开帖说"相乘才是痛点的真实规模。

### 6. 写报告

按「输出格式」成文写 `report.md`，然后 `action="report", report=<全文>` 落盘。

**输出格式（强制）**：

```
## 调研结论
[核心发现 3-5 句。第一段先复述研究问题与样本口径：<品类> · <决策问题> · <N 帖有效样本 / 时间窗>]

## 关键痛点（按评分卡排序）
1. [痛点主题] — [命中 N 帖] — 代表帖：[链接]

## 矛盾与不确定
[分歧处；样本偏差；数据不足写「需补调研：X」]

## 来源清单
- "用户原话（英文）" / "中文翻译" — r/sub [帖ID] (score:X, comments:Y, YYYY-MM-DD) — https://www.reddit.com/r/sub/comments/帖ID/
```

### 7. 数字闭环（发稿前必须）

`action="verify"`：自动核对报告里每个引用帖 ID 是否在数据集、score/comments/日期是否一致。**不通过 = 有编造或抄错的引用，必须清零再发。** 数据不足时如实写"样本不足"，禁止凑数编造。

## ⚠️ 五个必须先知道的坑

1. **「URL 加 .json」不可用**（匿名端点 403；官方 API 人工审批基本不批）。走 Arctic Shift。
2. **错误形态判读**：全站关键词查询（无 sub）400 = 形态不允许**不重试**；**任何请求 422 "Timeout" = 瞬态过载退避重试 3–5 次**（实测同参第 2 次即 200，不能当永久失败——部分数据被当全量写进报告是重大事故）；429/5xx/连接失败重试。全量拉取 + 本地过滤始终是主路径。
3. **时间窗必须先算样本量**（见步骤 1）。多 sub 各自独立进程/日志；禁止给采集命令加 `| tail -N`（吞掉逐页进度）。
4. **高热度社区必须剔除"作品展示帖"，判据提到标题级**。r/esp32 晒作品帖 score 2031 > 任何痛点帖；全文判据召回 40% 污染严重，标题级收敛到纯度可用。
5. **电商/美妆/假发类必须剔 KOC 软文**（见步骤 4）；**但也不要跨品类沿用假设**——潮玩实测软文仅 0.2%。每个品类独立实测。

## 痛点提取 SOP（分析阶段的语义纪律）

1. 关键词过滤是"召回"不是"判定"——`"finally cracked it"`（正面）会被 `crack` 命中，引用前必须读原文
2. 求助型单独立类：工程社区痛点绝大多数是求助帖（why/how/not working/need help），只按吐槽词过滤漏掉 60%+（实测抱怨:求助 ≈ 1:3.7）
3. 情绪三分：pain / praise（纯称赞且无 pain 信号）/ neutral（中立/求助归痛点）。neutral 混进 praise 会让好评率虚高
4. 主题短词 `\b` 词边界（见步骤 3）
5. 热度排序注意倒挂：`score 35 / comments 71` 常比 `score 200 / comments 10` 更说明问题
6. 评论区经常把归因彻底推翻（原帖控告 A 厂，高赞评论指出是 B 家的责任）——评论树补刀不可省

## 合规与边界（发布前必读）

- **定位**：个人/一次性市场与产品研究。Arctic Shift 为未经 Reddit 明确授权的社区档案，此类使用通常被默许但无任何保证
- **禁止**：做成对外产品功能；用于 AI 模型训练（Reddit 2024+ ToS 明令禁止）；转售数据
- **只读**：本插件不含任何发帖/评论/点赞自动化——那是封号 + ToS 红线
- **引用礼仪**：公开报告保留原帖链接与作者名，勿整段搬运超出合理引用范围

## 资源

| 路径 | 何时加载 |
|---|---|
| `references/api_endpoints.md` | 端点参数、错误码细节、自检命令（需要时） |
| `references/deep_research_10_modules.md` | 商业决策 7 模块框架（B1–B7）、KOC 剔除细则、选品报告结构——商业机会类调研**先读再采** |
| `assets/themes_esp32.json` / `themes_llm.json` | 主题表模板（硬件/AI 域），按品类改写 |
| `assets/signals.json` | 商业信号默认表（购买/付费/流失/退货，已内置） |
