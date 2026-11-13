// 真实 API 冒烟：探活 → 小窗口全量拉取 → 分析 → 评论补刀 → 数字闭环全链。
//   node scripts/live.mjs [subreddit] [days]   默认 esp32 / 3 天（约 1-2 页，几十秒）
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [, , subArg, daysArg] = process.argv
const sub = (subArg || 'esp32').replace(/^r\//i, '')
const days = Number(daysArg) || 3
const home = process.env.DSH_HOME || mkdtempSync(join(tmpdir(), 'rr-live-'))
process.env.DSH_HOME = home
console.log('DSH_HOME =', home)

const { redditResearchTool } = await import('../src/host.js')
const call = async (args) => redditResearchTool.execute(args, {})
const t0 = Date.now()
const at = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`

console.log(at(), `探活 r/${sub}（${days} 天窗口）…`)
const probe = await call({ action: 'probe', subs: sub, days })
console.log(probe.summary)

const STUDY = 'live-验证'
console.log(at(), `创建调研 + 全量拉取…`)
await call({ action: 'create', name: STUDY, question: `${sub} 近 ${days} 天用户痛点`, subs: sub, days })
const fetch = await call({ action: 'fetch', name: STUDY, subs: sub, days })
console.log(at(), fetch.summary)

const themes = {
  '电源/电池': 'batter|charg|power|brownout|\\b5v\\b|3\\.3v',
  '连接稳定性': 'wifi|\\bble\\b|bluetooth|disconnect|mqtt',
  '烧录/固件': 'flash|firmware|bootload|esptool|\\bote\\b',
  '开发环境': 'ide|arduino|platformio|esp-?idf|compile|\\bide\\b',
}
console.log(at(), `保存主题表 + 分析…`)
const th = await call({ action: 'themes', name: STUDY, themes: JSON.stringify(themes), scope: 'esp32|wifi|batter|power|flash|firmware' })
if (!th.ok) { console.error(th.summary); process.exit(1) }
const an = await call({ action: 'analyze', name: STUDY })
console.log(at(), an.summary)

console.log(at(), `评论树补刀…`)
const cm = await call({ action: 'comments', name: STUDY })
console.log(at(), cm.summary)

console.log(at(), `写最小报告 + 数字闭环校验…`)
const detail = await call({ action: 'read', name: STUDY, what: 'detail' })
const analysis = JSON.parse(readFileSync(join(home, 'reddit-research', STUDY, 'analysis.json'), 'utf8'))
const cand = analysis.commentCandidates[0]
let report = ''
if (cand) {
  report = `## 调研结论
r/${sub} 近 ${days} 天 ${an ? analysis.sample : 0} 帖样本，评分卡 Top1：${analysis.scorecard[0]?.theme || '无'}（${analysis.scorecard[0]?.score ?? 0} 分）。

## 关键痛点
1. ${analysis.scorecard[0]?.theme || '—'} — 代表帖：
**${(cand.title || '').slice(0, 60)}**
   r/${cand.subreddit} · score ${cand.score} · ${cand.num_comments} 评论 · ${new Date(cand.created_utc * 1000).toISOString().slice(0, 10)}
   <https://www.reddit.com${cand.permalink}>
`
} else {
  report = `## 调研结论\n无相关痛点候选（展示帖占比 ${analysis.showcaseShare}%）。\n`
}
await call({ action: 'report', name: STUDY, report })
const v = await call({ action: 'verify', name: STUDY })
console.log(at(), v.summary)
console.log(v.ok ? `\n全链 ${((Date.now() - t0) / 1000).toFixed(0)}s 完成 ✓` : '\n闭环未通过（报告为最小样例，日期/score 需与数据一致）')
