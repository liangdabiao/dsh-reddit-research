// 标题级痛点分析（analyze_title_level.py 全量移植）：
// 五分类（抱怨/求助/展示/称赞/其他，NEG>问号>showcase>praise 判据顺序）→ 主题表归类 →
// 趋势（近30 vs 前30）→ 痛点评分卡（普遍度50×严重度30×趋势20）→ 商业信号 → 数据体检。
// 附加：KOC 软文检测（电商/美妆类必须跑；每品类独立实测，不跨品类沿用假设）。
export const TITLE_Q = new RegExp(
  '^\\s*(why |how (do|can|to|should|would|is)|what (is|are|should)|when |where |'
  + "can'?t |cannot |couldn'?t |won'?t |doesn'?t |does not |isn'?t |not |"
  + 'anyone (know|else|have|any)|any(one|body) (know|idea|advice|help)|'
  + 'looking for|need (help|advice|some)|help|advice|trouble|issue|problem|'
  + 'stuck|struggl|no idea|what am i|is this (normal|expected|a problem|working)|'
  + "should i|would it|am i (wrong|doing)|which |what'?s the (best|right|difference))",
  'i',
)

export const TITLE_NEG = new RegExp(
  '(broken|break(?:s|ing)? (up|apart|down)|broke|died|dead|dying|burn|smoke|smoking|'
  + 'bricke?d|unbrick|fake|counterfeit|clone|defective|doa|'
  + "stopped (working|charging|connecting)|no longer works|not working|doesn'?t work|won'?t work|"
  + 'overheat\\w*|too hot|melt\\w*|'
  + '(disappoint\\w*|frustrat\\w*|regret\\w*|nightmare|terrible|horrible|awful|worst|useless|'
  + 'worthless|garbage|junk|sucks|rip.?off|scam\\w*|bad experience|not worth|waste of (money|time))'
  + '|(gave up|give up|abandon\\w*|never again|last time|moved on|switched to)'
  + '|(hard|struggl\\w*|difficult|trouble) (to|with)|hate(s|d)?|angry|annoying|infuriating|'
  + 'inaccurate|unreliable|unusable|unstable|flaky|intermittent|flimsy|'
  + 'warning|be careful|beware|avoid|caveat|lessons? learned|'
  + "can'?t get|can'?t figure|can'?t make|couldn'?t get|couldn'?t figure|"
  + 'not detectable|not recognized|not recognised|not showing up|not responding|'
  + 'not (charging|connecting|pairing|flashing|booting|syncing|powering)|'
  + "won'?t (boot|start|connect|pair|flash|turn on|power|sync|link)|"
  + 'out of memory|stack overflow|'
  + 'bootloop|boot loop|keeps? resetting|randomly (reboot|disconnect|crash)'
  + '|\\bfail(s|ed|ing|ure|ures)?\\b|crash(es|ed|ing)?(?! ?course)'
  + '|reboot(s|ing)?\\b|disconnect(s|ed|ing)?\\b|drain(s|ed|ing)?\\b'
  + '|freezes?|froze|frozen|freezing|lag(s|gy|ging)?\\b|jitter\\w*|stutter\\w*'
  + '|keeps? (re)?(boot\\w*|restart\\w*|crash\\w*|disconnect\\w*|freez\\w*|reset\\w*|dropp\\w*|fail\\w*)'
  + '|wrong (reading|value|data|result|temp|time)|loses? (connection|power|time|data)'
  + '|\\bsheds\\b|shedding|shed (a lot|like crazy|everywhere|hair)'
  + '|tangl\\w*|matt(ing|ed)\\b|frizz\\w*|fray(ed|ing)\\b|fad(ed|ing)\\b'
  + '|peel(ing|ed)\\b|shrink(s|ing|age)?\\b|pilling|snag(ged|ging)?\\b'
  + "|\\bitchy\\b|\\bitches\\b|\\bitching\\b(?! to\\b)"
  + '|smells? (bad|awful|terrible|weird|funny|burnt|like (chemical|plastic|burnt))|smelly|stinks?|stinking|\\bodor\\b'
  + '|slip(s|ped|ping)? (off|down|out)\\b|tear(s|ing)?\\b|tore\\b'
  + '|\\bpain(ful)?\\b|headache|nightmare fuel)',
  'i',
)

export const TITLE_POS = new RegExp(
  "(works? (great|perfectly|like a charm|flawlessly|beautifully)|working (great|perfectly|flawlessly)"
  + '|love(d|s)? (it|this|these|them|my)|highly recommend'
  + '|best (purchase|buy|decision|investment|upgrade)'
  + '|game.?changer|must.?have|exceeded (my |our )?expectations'
  + '|worth every (penny|dollar|cent)|no (regrets|complaints)'
  + '|amazing|awesome|flawless|solid (build|quality|choice|pick|performance)'
  + '|very (happy|pleased|satisfied)|super happy|really (happy|impressed|pleased)'
  + '|impressed|10/10|five stars)',
  'i',
)

export const SHOWCASE_TITLE = new RegExp(
  '^\\s*((just|finally) (sharing|showing|showed|showed off|finished|completed|got|built|made|created|ported)'
  + '|i (built|made|created|designed|finished|completed|ported|trained|added|'
  + 'replaced|found|crammed|started|used|pushed|served|watch)'
  + '|my \\w|we (built|made|did|ported)|show(t|r)?case|introducing|'
  + 'look at|check out|presenting|sharing|progress|update|weekend|fun|'
  + '\\[.*(pics?|photos?|video|build|project).*\\])',
  'i',
)

export const SEVERITY_RX = new RegExp(
  '(scam|fraud|\\bdanger\\w*|injur\\w*|\\bhurt|chemical burn|burn(ed|t)? (my|the|me|skin)'
  + '|hair loss|\\bbald|broke me out|allergic|infection|\\brash\\b|swollen|hospital'
  + '|ruined|destroyed|wasted (my |money|time)|money (down the drain|gone|wasted)'
  + '|never (again|buying|ordering)|\\bdangerous\\b|\\bfire\\b|fire hazard|shock(ed)? me'
  + '|electrocut\\w*|data loss|bricked|unusable|threw (it|them|mine) (away|out)|in the trash)',
  'i',
)

// KOC 软文检测（上游坑5：r/Wigs 等晒单强制带购买链接 → 品牌方/KOC 伪装用户发帖；
// 被剔除的恰好是分数最高的"正面评价"，不剔除会得出完全相反的结论）
export const PROMO_RX = new RegExp(
  'utm_(source|medium|campaign)=[^&\\s]*(rdkoc|reddit|seeding|influencer)'
  + '|\\?rdkoc|\\bkoc\\b|affiliate|shop\\.[a-z0-9-]+\\.com|https?://[a-z0-9.-]+\\.(com|net|shop|store)/?(\\s|$)',
  'i',
)

// 商业信号默认表（与上游 assets/signals.json 同源）
export const DEFAULT_SIGNALS = {
  购买意图: 'just (ordered|bought|picked up|got (mine|one))|about to (buy|order|pull the trigger)|thinking of (buying|getting|ordering)|on my (buy |wish )?list|waiting for (a )?sale|purchased (it|one|mine|this)|placed (my|an) order|in my cart',
  付费意愿: "(would|'d|will) pay (up to |around |even |easily )?[$]?[0-9]+|pay (extra|more|a premium|double)|worth every (penny|dollar|cent)|no hesitation paying|take my money|shut up and take my money",
  '弃用/流失': 'switched to|moved (to|on from) |stopped using|gave up on|canceled my (order|subscription)|cancelled my (order|subscription)|abandoned|went back to|no longer (use|buy|wear)',
  '退货/退款': 'return(ed|ing)? (it|mine|this|them)|sent (it|this|them) back|got a (full )?refund|request(ed|ing)? a refund|chargeback|dispute[d]? the charge|money back',
}

const rx = (s, flags = 'i') => new RegExp(s, flags)

/** 编译 {"名称": "正则"}；坏正则抛可读错误。 */
export function compileMap(raw, what) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.values(raw).every((v) => typeof v === 'string')) {
    throw new Error(`${what} 文件结构应为 {"名称": "正则"}`)
  }
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    try { out[k] = rx(v) } catch (e) { throw new Error(`${what}「${k}」的正则无效: ${JSON.stringify(v)} (${e.message})`) }
  }
  return out
}

export const titleOf = (p) => String(p?.title || '')
export const bodyOf = (p) => String(p?.selftext || '')
export const fulltext = (p) => `${titleOf(p)} ${bodyOf(p)}`
export const heat = (p) => (p?.score || 0) + (p?.num_comments || 0)
export const dayOf = (u) => (u ? new Date(u * 1000).toISOString().slice(0, 10) : null)

/** 五分类。判据顺序 = 优先级：NEG > Q(含问号) > showcase > praise > other。
 *  上游修正：旧版先判 showcase 会把 "My ESP32 keeps rebooting" 这类真痛点吞掉——NEG/Q 优先，
 *  含问号的标题一律按求助处理（晒作品帖标题几乎不写问号）。 */
export function classify(p) {
  const ti = titleOf(p)
  if (TITLE_NEG.test(ti)) return 'complaint'
  if (TITLE_Q.test(ti) || ti.includes('?')) return 'help'
  if (SHOWCASE_TITLE.test(ti)) return 'showcase'
  if (TITLE_POS.test(ti)) return 'praise'
  return 'other'
}

/** 读数据目录（*.json + *.jsonl，按 id 去重；同名 .meta 的 cutoff 过滤窗口外帖子）。 */
export function loadPosts(dataDir) {
  return loadPostsImpl(dataDir)
}

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join as joinPath, basename, dirname } from 'node:path'

function cutoffFor(file) {
  const metaFile = joinPath(dirname(file), basename(file).replace(/\.jsonl?$/i, '') + '.meta')
  try {
    if (!existsSync(metaFile)) return null
    const c = JSON.parse(readFileSync(metaFile, 'utf8')).cutoff
    return c ? Number(c) : null
  } catch { return null }
}

function loadPostsImpl(dataDir) {
  const posts = []
  const seen = new Set()
  let files = 0
  let outOfWindow = 0
  const patterns = []
  try {
    if (statSync(dataDir).isDirectory()) {
      patterns.push(...readdirSync(dataDir).filter((f) => /\.json$/i.test(f)).sort().map((f) => joinPath(dataDir, f)))
      patterns.push(...readdirSync(dataDir).filter((f) => /\.jsonl$/i.test(f)).sort().map((f) => joinPath(dataDir, f)))
    } else patterns.push(String(dataDir))
  } catch { /* 目录不存在 → 空 */ }
  for (const f of patterns) {
    if (/\.meta$/.test(f)) continue
    files++
    const cut = cutoffFor(f)
    let items = null
    try {
      if (/\.jsonl$/i.test(f)) {
        items = []
        for (const line of readFileSync(f, 'utf8').split('\n')) {
          const s = line.trim()
          if (!s) continue
          try { items.push(JSON.parse(s)) } catch { /* 崩溃半截行 */ }
        }
      } else {
        const d = JSON.parse(readFileSync(f, 'utf8'))
        if (Array.isArray(d)) items = d
      }
    } catch { continue }
    if (!items) continue
    for (const p of items) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue
      if (!p.id || seen.has(p.id)) continue
      if (cut !== null && (p.created_utc || 0) < cut) { outOfWindow++; continue }
      seen.add(p.id)
      posts.push(p)
    }
  }
  return { posts, files, outOfWindow }
}

/**
 * 完整帖级分析。返回结构化结果（面板/工具共用）。
 * @param opts { themes:{"名":"正则"}, focus?, focusMin=2, scope?, signals?(默认 DEFAULT_SIGNALS), showcaseTop=30, promoCheck=false }
 */
export function analyzePosts(posts, opts = {}) {
  const themes = opts.themes ? compileMap(opts.themes, '主题表') : {}
  const focus = opts.focus ? compileMap(opts.focus, '定向表') : {}
  const focusMin = opts.focusMin ?? 2
  const signals = opts.signals ? compileMap(opts.signals, '商业信号表') : compileMap(DEFAULT_SIGNALS, '商业信号表')
  const showcaseTop = opts.showcaseTop ?? 30

  posts.sort((a, b) => heat(b) - heat(a))
  const buckets = { complaint: [], help: [], showcase: [], praise: [], other: [] }
  for (const p of posts) {
    p._themes = Object.entries(themes).filter(([, r]) => r.test(fulltext(p))).map(([n]) => n)
    buckets[classify(p)].push(p)
    p._promo = opts.promoCheck ? PROMO_RX.test(fulltext(p)) : false
  }

  // Top N 高互动帖展示帖占比（>50% = 情感展示型，痛点必须关键词定向挖掘）
  const top = posts.slice(0, showcaseTop)
  const showIds = new Set(buckets.showcase.map((p) => p.id))
  const topShow = top.filter((p) => showIds.has(p.id)).length
  const showcaseShare = top.length ? +((topShow / top.length) * 100).toFixed(1) : 0
  const showcaseVerdict = showcaseShare > 50
    ? '⚠ >50% → 情感展示型！痛点必须用关键词定向筛选，不能靠热度排序发现'
    : showcaseShare <= 30 ? '✓ ≤30% → 热度排序基本可用' : '△ 30–50% → 部分可用，引用前需逐帖复核是否晒单'

  // 数据体检：sub 构成
  const subs = {}
  for (const p of posts) subs[p.subreddit || '?'] = (subs[p.subreddit || '?'] || 0) + 1
  const subParts = Object.entries(subs).sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `r/${s} ${c} (${(c * 100 / posts.length).toFixed(1)}%)`)

  // 数据体检：与调研目标的相关性（--scope）
  let scope = null
  if (opts.scope) {
    const srx = rx(opts.scope)
    const relevant = posts.filter((p) => srx.test(fulltext(p)))
    const relShare = +(relevant.length * 100 / posts.length).toFixed(1)
    scope = {
      relevant: relevant.length, total: posts.length, share: relShare,
      verdict: relShare < 30
        ? '✗ <30% → 数据与调研目标严重脱节！先检查数据构成/换 sub/收紧时间窗'
        : relShare < 60 ? '△ 30–60% → 相关性一般，写报告只取相关帖' : '✓ ≥60% → 相关性良好',
    }
  }

  // KOC 软文（promoCheck=true 时统计）
  const promoPosts = opts.promoCheck ? posts.filter((p) => p._promo) : null

  // 趋势（近30天 vs 前30天；窗口<60天用后半 vs 前半）
  const spanTs = posts.map((p) => p.created_utc || 0).filter(Boolean)
  const arrows = {}
  const trendOf = (theme) => {
    const ts = [...buckets.complaint, ...buckets.help]
      .filter((p) => p._themes.includes(theme) && p.created_utc)
      .map((p) => p.created_utc).sort((a, b) => a - b)
    if (ts.length < 3 || !spanTs.length) { arrows[theme] = { recent: null, prior: null, arrow: '–' }; return }
    const lo = Math.min(...spanTs)
    const hi = Math.max(...spanTs)
    let recentCount, priorCount
    if (hi - lo >= 60 * 86400) {
      const boundary = hi - 30 * 86400
      recentCount = ts.filter((t) => t >= boundary).length
      priorCount = ts.filter((t) => t >= boundary - 30 * 86400 && t < boundary).length
    } else {
      const mid = (lo + hi) / 2
      recentCount = ts.filter((t) => t >= mid).length
      priorCount = ts.length - recentCount
    }
    let arrow
    if (priorCount === 0 && recentCount > 0) arrow = '↑↑'
    else if (priorCount === 0 && recentCount === 0) arrow = '–'
    else {
      const ratio = recentCount / priorCount
      arrow = ratio >= 1.5 ? '↑' : ratio <= 0.67 ? '↓' : '→'
    }
    arrows[theme] = { recent: recentCount, prior: priorCount, arrow }
  }

  // 痛点评分卡：普遍度(50) × 严重度(30) × 趋势(20)，0-100
  const painByTheme = {}
  for (const p of [...buckets.complaint, ...buckets.help]) {
    for (const t of p._themes) (painByTheme[t] ||= []).push(p)
  }
  // 趋势对评分卡可用性优先：先算趋势，评分卡的 bonus 与主题表输出都依赖 arrows
  const allPainThemes = new Set()
  for (const p of [...buckets.complaint, ...buckets.help]) p._themes.forEach((t) => allPainThemes.add(t))
  for (const t of allPainThemes) trendOf(t)
  const pMax = Math.max(0, ...Object.values(painByTheme).map((v) => v.length))
  const scorecard = Object.entries(painByTheme).map(([t, plist]) => {
    const sev = plist.filter((p) => SEVERITY_RX.test(fulltext(p))).length / plist.length
    const a = arrows[t] || { arrow: '–', prior: null, recent: null }
    const bonus = a.arrow === '↑' || a.arrow === '↑↑' ? 20 : a.arrow === '→' ? 10 : 0
    return {
      theme: t, n: plist.length, sev: +sev.toFixed(2), arrow: a.arrow,
      delta: a.recent !== null ? `${a.prior}→${a.recent}` : '–',
      score: Math.round((pMax ? plist.length / pMax : 0) * 50 + sev * 30 + bonus),
    }
  }).sort((a, b) => b.score - a.score)

  // 商业信号（帖级）
  const signalPosts = {}
  for (const [name, r] of Object.entries(signals)) signalPosts[name] = posts.filter((p) => r.test(fulltext(p)))

  // 品类定向
  let focusHits = null
  if (Object.keys(focus).length) {
    focusHits = []
    for (const p of posts) {
      const hit = Object.entries(focus).filter(([, r]) => r.test(fulltext(p))).map(([n]) => n)
      if (hit.length >= focusMin) { p._focus = hit; focusHits.push(p) }
    }
    focusHits.sort((a, b) => b._focus.length - a._focus.length || heat(b) - heat(a))
  }

  // 评论树补刀建议：痛点/口碑层 top（非全局热度 top）；scope 模式下严格过滤
  const srx = opts.scope ? rx(opts.scope) : null
  const rank = (p) => ((srx && !srx.test(fulltext(p)) ? 1 : 0) * 1e12) - heat(p)
  const pick = (bucket) => {
    let cand = [...bucket].sort((a, b) => rank(a) - rank(b)).slice(0, 5)
    if (srx) cand = cand.filter((p) => srx.test(fulltext(p)))
    return cand
  }
  const commentCandidates = [...pick(buckets.complaint), ...pick(buckets.help)].filter((p) => p.id)

  return {
    sample: posts.length,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    showcaseShare, showcaseVerdict,
    subs: subParts, scope, promo: promoPosts ? { count: promoPosts.length, share: +(promoPosts.length * 100 / posts.length).toFixed(1), posts: promoPosts.slice(0, 10) } : null,
    themes: Object.fromEntries(Object.entries(themes).map(([n]) => {
      const c = buckets.complaint.filter((p) => p._themes.includes(n)).length
      const h = buckets.help.filter((p) => p._themes.includes(n)).length
      return [n, { complaint: c, help: h, ...arrows[n] }]
    })),
    scorecard,
    signals: Object.fromEntries(Object.entries(signalPosts).map(([k, v]) => [k, { count: v.length, share: posts.length ? +(v.length * 100 / posts.length).toFixed(1) : 0 }])),
    focus: focusHits ? { min: focusMin, count: focusHits.length } : null,
    commentCandidates,
    span: spanTs.length ? { from: dayOf(Math.min(...spanTs)), to: dayOf(Math.max(...spanTs)) } : null,
  }
}

/** 渲染 markdown（analyze_title_level 输出格式的移植）。 */
export function renderAnalysis(res, { top = 40, promoCheck = false } = {}) {
  const L = ['# 痛点分析（标题级判据）', '']
  L.push(`**样本** ${res.sample} 帖${res.span ? ` · ${res.span.from} .. ${res.span.to}` : ''}`, '')
  L.push(
    `- 体验差/翻车类（抱怨）：**${res.buckets.complaint}** 帖`,
    `- 卡住了/弄不通类（求助）：**${res.buckets.help}** 帖`,
    `- 剔除作品展示帖：${res.buckets.showcase} 帖`,
    `- 纯称赞（praise，可作口碑/特性素材）：${res.buckets.praise} 帖`,
    `- 其他（低置信，引用前需逐帖复核）：${res.buckets.other} 帖`,
    `- **Top30 高互动帖中展示帖占比：${res.showcaseShare}%** — ${res.showcaseVerdict}`,
  )
  if (res.scope) L.push(`- **数据-目标相关性：${res.scope.relevant}/${res.scope.total} 帖（${res.scope.share}%）** — ${res.scope.verdict}`)
  L.push(`- 数据构成：${res.subs.slice(0, 10).join('、')}${res.subs.length > 10 ? ` …共 ${res.subs.length} 个 sub` : ''}`)
  if (res.promo) L.push(`- **KOC 软文检测：${res.promo.count} 帖（${res.promo.share}%）** — 被剔除的往往是分数最高的"正面评价"，引用前先剔除${res.promo.count === 0 ? '；0 帖不能默认干净，先人工看 top 10 高分帖正文有无品牌官网裸链' : ''}`)
  if (res.focus) L.push(`- 品类定向命中（≥${res.focus.min} 组）：**${res.focus.count}** 帖`)
  L.push('', '> 判据：标题级。全文关键词过滤会被 score 2000+ 的晒作品帖霸榜（实测 2819 帖 → 847 帖）。引用前仍需读原文复核语义。', '')

  L.push('## 主题频次', '', '| 主题 | 抱怨类 | 求助类 | 趋势 |', '|---|---:|---:|---|')
  const themeRows = Object.entries(res.themes).sort((a, b) => (b[1].complaint + b[1].help) - (a[1].complaint + a[1].help))
  for (const [k, v] of themeRows) L.push(`| ${k} | ${v.complaint} | ${v.help} | ${v.arrow} |`)

  if (res.scorecard.length) {
    L.push('', '## 痛点评分卡（普遍度 × 严重度 × 趋势）', '', '| 主题 | 痛点帖 | 严重度 | 趋势 | 评分 |', '|---|---:|---:|---|---:|')
    for (const r of res.scorecard) L.push(`| ${r.theme} | ${r.n} | ${(r.sev * 100).toFixed(0)}% | ${r.arrow} (${r.delta}) | **${r.score}** |`)
    L.push('', '> 评分 = 普遍度(50，按命中帖数归一化) + 严重度(30，强后果词占比) + 趋势(上升20/持平10/下降0)。上升趋势的痛点 = 机会窗口；引用前必须人工读原文复核语义。')
  }

  L.push('', '## 商业信号（帖级）', '', '| 信号 | 帖数 | 占比 |', '|---|---:|---:|')
  for (const [k, v] of Object.entries(res.signals)) L.push(`| ${k} | ${v.count} | ${v.share}% |`)
  L.push('', '> 购买意图/付费意愿 = 需求规模证据；弃用/退货 = 风险与竞品切入口。评论级统计（含代表引语）跑 comments 通道，粒度更细。')

  if (res.commentCandidates.length) {
    L.push('', '## 下一步：评论树补刀（痛点/口碑层 top，非全局热度 top）', '')
    L.push('候选帖 ID（complaint+help 层）：`' + res.commentCandidates.map((p) => p.id).join(' ') + '`')
    L.push('', '> 不要对全局热度 top 抓评论——那大概率是展示帖，评论只会是 "Awesome!"，写进痛点报告就是答非所问。')
  }
  return L.join('\n')
}
