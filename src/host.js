// ============================================================================
// Reddit 调研台 · Host 半边（Node 主进程，纯 ESM）。
// 工具：reddit_research（probe/create/fetch/themes/analyze/comments/report/verify/read/list/delete）。
// webServer 前缀路由：面板数据面（与工具共用 lib/ops.js，一份逻辑两个入口）。
// 数据源：Arctic Shift 档案 API（免认证）。只读采集——不含任何发帖/评论自动化。
// ============================================================================
import Schema from '@deepseek-ai/schemastery'
import {
  probe, fetchStudy, analyzeStudy, saveThemes, commentsStudy, verifyStudy,
  saveReport, studyDetail, listStudies, createStudy, deleteStudy,
} from '../lib/ops.js'
import { registerApi } from '../lib/api.js'

export const name = 'reddit-research' // = cordis.patch.yml 的 id

export const inject = ['tools', 'webServer']

export const Config = Schema.object({
  studiesRoot: Schema.string().default('').description('调研存放根目录（留空 = $DSH_HOME/reddit-research）'),
  maxPages: Schema.number().min(1).max(2000).default(600).description('单 sub 分页上限（600 页 ≈ 6 万帖）'),
})

const configRef = { config: Config }

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`reddit_research 参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：分析报告/校验问题/结构化 JSON 等文本' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

const DISCIPLINE = `纪律：①结论必须附原帖链接（来源引用格式）②只引用与调研目标相关的帖，无关帖/纯晒单一律不写 ③数据不足写「需补调研：X」，禁止凑数编造 ④引用前读原文复核语义（crack 命中 "finally cracked it" 是正面）⑤报告写完必须 verify 数字闭环。`

export const redditResearchTool = {
  name: 'reddit_research',
  description:
    'Reddit 深度调研工作台：从 subreddit 抓取真实用户讨论（Arctic Shift 免认证档案 API），输出痛点评分卡、商业信号（购买/付费/流失/退货）、竞品口碑与选品/进入决策报告，全部结论带原帖链接可复算。' +
    '用户说「调研 reddit」「r/xxx 在聊什么」「reddit 用户怎么看 xxx」「某品类值不值得做」「选品/竞品分析」「reddit 高赞帖」时使用。' +
    '工作目录 $DSH_HOME/reddit-research/<调研名>/。只读采集，不含发帖/评论自动化。' +
    '流程：probe 探活并自动定窗（按页数预算 ≤20 页，超了自动缩窗，不需要用户确认）→ fetch 全量拉取 → themes 主题表（按品类重建，短词加 \\b）→ analyze（五分类+评分卡）→ comments（痛点层补刀，禁止对全局热度 top 抓评论）→ 写 report.md → verify 数字闭环。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('probe 探活估样本量；create 建调研；fetch 全量拉取（断点续传）；themes 保存主题表+scope；analyze 帖级分析（五分类+评分卡+商业信号）；comments 评论树补刀+评论级分析；report 保存报告；verify 数字闭环校验；read 读产物；list 列调研；delete 删调研；feed 海外动态（16 精选社区最新帖流）', { enum: ['probe', 'create', 'fetch', 'themes', 'analyze', 'comments', 'report', 'verify', 'read', 'list', 'delete', 'feed'] }),
      name: str('调研名（可中文，如 假发品类调研）'),
      question: str('create 必填：研究问题（品类/产品 + 要回答的决策问题 + 目标用户，一行钉死，没有它后面所有筛选没有准绳）'),
      subs: str('subs：subreddit 列表（逗号分隔，不带 r/ 前缀；fetch 缺省用 create 时登记的）'),
      limit: num('feed 可选：每社区拉多少帖（默认 25，单社区模式 ≤100）'),
      days: num('时间窗天数（probe 默认 30；fetch 缺省用 probe 自动定下的窗口，其次 create 时登记的，默认 90）'),
      fresh: str('fetch 可选：true=忽略断点从头重抓', { enum: ['true', 'false'] }),
      themes: str('themes 必填：主题表 JSON 字符串 {"主题名": "正则"}（按品类重建；短词 ap/log/can/pin/ram/doc/ota/ble 裸写会误命中普通词，必须 \\b 词边界）'),
      scope: str('themes 可选 + analyze/comments 可选：调研目标相关性正则（品类/产品关键词）——输出数据体检占比，<30% 先修数据再写报告'),
      promoCheck: str('analyze 可选：true=跑 KOC 软文检测（电商/美妆/假发类必开；潮玩类实测仅 0.2% 不必开——每品类独立实测）', { enum: ['true', 'false'] }),
      focus: str('analyze 可选：品类定向配置 JSON {"组名": "正则"}（命中 ≥focusMin 组的帖单独列出）'),
      focusMin: num('analyze 可选：定向命中组数阈值（默认 2）'),
      ids: str('comments 可选：要抓评论树的帖 ID（逗号分隔；缺省用 analyze 产出的痛点层候选）'),
      top: num('comments 可选：每主题代表评论条数（默认 5）'),
      report: str('report 必填：报告全文 markdown（按固定输出格式；每条结论附原帖链接）'),
      what: str('read 必填：analysis 帖级分析 / comments 评论级分析 / detail 元数据+数据构成 / journal 时间线', { enum: ['analysis', 'comments', 'detail', 'journal'] }),
      title: str('read 可选：无意义占位（保持参数面稳定）'),
    },
  },
  timeoutMs: 600_000,
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    const cfg = configRef.config
    try {
      if (args.action === 'feed') {
        const { FEED_SUBS, FEED_GROUPS, fetchFeedPage, fetchFeedMulti } = await import('../lib/feed.js')
        if (!args.subs) {
          return result(true, `海外动态：${FEED_SUBS.length} 个精选社区（${FEED_GROUPS.join(' / ')}）。传 subs="saas" 拉单社区最新帖，或不传 subs 列全部目录。`,
            FEED_SUBS.map((s) => `r/${s.sub}｜月访问 ${s.visits}｜${s.group}｜${s.desc}`).join('\n'))
        }
        const subs = String(args.subs).split(/[,，]/).map((s) => s.trim().replace(/^r\//i, '')).filter(Boolean)
        if (subs.length === 1) {
          const r = await fetchFeedPage(subs[0], { limit: Math.min(args.limit || 100, 100) })
          const lines = r.posts.map((p) => `[${p.score ?? '-'}👍/${p.num_comments ?? 0}💬] ${p.title} — u/${p.author} ${new Date((p.created_utc || 0) * 1000).toISOString().slice(0, 10)} https://www.reddit.com${p.permalink || ''}`)
          const note = r.collapsed ? `，已折叠 ${r.collapsed} 条重复/已删帖` : ''
          return result(true, `r/${r.sub} 最新 ${r.posts.length} 帖（Arctic Shift 滞后约 36h；只读采集${note}）。`, lines.join('\n'))
        }
        const multi = await fetchFeedMulti(subs, { limit: Math.min(args.limit || 25, 100) })
        const parts = multi.map((r) => r.ok
          ? `r/${r.sub}: ${r.posts.length} 帖\n` + r.posts.slice(0, 10).map((p) => `  [${p.score ?? '-'}👍] ${p.title} — ${new Date((p.created_utc || 0) * 1000).toISOString().slice(0, 10)} https://www.reddit.com${p.permalink || ''}`).join('\n')
          : `r/${r.sub}: ✗ ${r.error}`)
        return result(true, `海外动态 ${multi.filter((r) => r.ok).length}/${subs.length} 个社区。`, parts.join('\n\n'))
      }

      if (args.action === 'list') {
        const studies = listStudies(cfg)
        if (!studies.length) return result(true, '还没有调研。用 action=create 建一个（先想清楚研究问题）。')
        return result(true, `共 ${studies.length} 个调研（新→旧）`, studies.map((s) =>
          `${s.name}｜${s.subs.map((x) => 'r/' + x).join(',')}｜${s.days}天｜${s.with_data}/${s.subs.length} sub 有数据${s.has_analysis ? '｜已分析' : ''}${s.has_comments ? '｜已补刀' : ''}${s.has_report ? `｜报告${s.verified === 'pass' ? '✓闭环' : s.verified === 'fail' ? '✗未闭环' : '（未校验）'}` : ''}`).join('\n'))
      }

      if (args.action === 'probe') {
        const subs = String(args.subs || '').split(/[,，]/).map((s) => s.trim().replace(/^r\//i, '')).filter(Boolean)
        if (!subs.length) throw new Error('probe 需要 subs（逗号分隔）')
        const r = await probe(cfg, args.name, subs, { days: args.days || 30 })
        return result(true, `${r.summary}\n\n窗口已按页数预算定好${r.plan?.shrunk ? '（原窗口超预算，已自动缩窗）' : ''}，直接 action="fetch" 即可 —— 不要回头找用户确认窗口。只有用户明确要求「要拉满 N 年/N 个月」时才照用户的窗口跑，并先回报预计页数与耗时。`)
      }

      if (args.action === 'create') {
        const subs = String(args.subs || '').split(/[,，]/).map((s) => s.trim().replace(/^r\//i, '')).filter(Boolean)
        const r = createStudy(cfg, args.name, { question: args.question, subs, days: args.days || 90 })
        return result(true, `调研「${r.name}」已创建（窗口 ${args.days || 90} 天）。研究问题：${args.question || '（未填——没有研究问题，后面所有筛选没有准绳！）'}。下一步：action="probe"（会自动算窗口建议并写回调研）→ 直接 action="fetch"，不用问用户窗口。`)
      }

      if (args.action === 'fetch') {
        const subs = args.subs ? String(args.subs).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined
        const r = await fetchStudy(cfg, args.name, { subs, days: args.days, fresh: args.fresh === 'true', maxPages: cfg?.maxPages })
        return result(true, r.summary, r.results.map((x) => `r/${x.sub}: ${x.total} 帖 / ${x.pages} 页｜${x.complete ? '完整' : '部分（' + x.stopReason + '）'}`).join('\n'))
      }

      if (args.action === 'themes') {
        let themes
        try { themes = JSON.parse(args.themes) } catch { throw new Error('themes 不是合法 JSON（应为 {"主题名": "正则"}）') }
        const r = saveThemes(cfg, args.name, themes, { scope: args.scope })
        return result(true, `主题表已保存（${r.count} 主题）${args.scope ? `，scope 正则已登记（数据体检与评论树候选过滤都会用它）` : ''}。下一步：action=analyze。`)
      }

      if (args.action === 'analyze') {
        const r = analyzeStudy(cfg, args.name, {
          focus: args.focus ? JSON.parse(args.focus) : undefined,
          focusMin: args.focusMin,
          scope: args.scope,
          promoCheck: args.promoCheck === 'true',
        })
        return result(true, `${r.summary}\n\n纪律：${DISCIPLINE}`, r.md)
      }

      if (args.action === 'comments') {
        const ids = args.ids ? String(args.ids).split(/[,，\s]+/).filter(Boolean) : undefined
        const r = await commentsStudy(cfg, args.name, { ids, scope: args.scope, top: args.top })
        return result(true, r.summary, r.md)
      }

      if (args.action === 'report') {
        const r = saveReport(cfg, args.name, args.report)
        return result(true, `报告已保存（${r.file}）。下一步必须 action=verify 做数字闭环校验——不通过不能发给用户。${DISCIPLINE}`)
      }

      if (args.action === 'verify') {
        const r = verifyStudy(cfg, args.name)
        return result(r.ok, r.summary, r.ok ? '' : r.problems.join('\n'))
      }

      if (args.action === 'read') {
        const detail = studyDetail(cfg, args.name)
        if (!detail) return result(false, `调研不存在：${args.name}`)
        if (args.what === 'detail') {
          return result(true, `「${args.name}」详情`, JSON.stringify({
            meta: detail.meta, data: detail.data, total: detail.total,
            themes: detail.themes ? Object.keys(detail.themes) : null,
            verified: detail.verified,
            analysis_headline: detail.analysis ? { sample: detail.analysis.sample, buckets: detail.analysis.buckets, showcaseShare: detail.analysis.showcaseShare, top3: detail.analysis.scorecard.slice(0, 3) } : null,
          }, null, 2))
        }
        if (args.what === 'journal') return result(true, `「${args.name}」时间线`, detail.journal.map((j) => `${(j.ts || '').slice(5, 19)} ${j.action} — ${j.summary || ''}`).join('\n'))
        const { readFileSync, existsSync } = await import('node:fs')
        const { studyDir } = await import('../lib/store.js')
        const file = studyDir(cfg, args.name) + `/${args.what === 'analysis' ? 'analysis.md' : 'comments.md'}`
        if (!existsSync(file)) return result(false, `还没有 ${args.what} 产物（先跑对应 action）`)
        const content = readFileSync(file, 'utf8')
        return result(true, `「${args.name}」${args.what}（${content.split('\n').length} 行）`, content.length > 12000 ? content.slice(0, 12000) + '\n…（截断，完整文件见面板）' : content)
      }

      if (args.action === 'delete') {
        const r = deleteStudy(cfg, args.name)
        return r.ok ? result(true, `已删除调研「${args.name}」`) : result(false, r.error)
      }

      throw new Error(`未知 action：${args.action}`)
    } catch (err) {
      return result(false, `reddit_research ${args.action} 失败：${err?.message || err}`)
    }
  },
}

export function apply(ctx, config) {
  configRef.config = config
  ctx.tools.register(redditResearchTool)
  ctx.effect(() => registerApi(ctx, configRef), `${name}: routes`)
}
