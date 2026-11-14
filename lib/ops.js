// 业务操作层：工具（src/host.js）与面板（lib/api.js）共用同一份逻辑，保证对话与面板是同一份数据。
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  listStudies, createStudy, deleteStudy, readMeta, saveMeta,
  writeJsonAtomic, writeTextAtomic, journal, readJournal, sanitizeName,
} from './store.js'
import { probeSubs, fetchSubreddit, fetchCommentTrees, fetchPostsByIds } from './reddit.js'
import { analyzePosts, renderAnalysis, loadPosts } from './analyze.js'
import { analyzeComments, renderComments, loadComments } from './comments.js'
import { verifyCitations } from './verify.js'

export { listStudies, createStudy, deleteStudy, readMeta, saveMeta, journal, readJournal, sanitizeName }

const studyDataDir = (config, name) => join(studyDirOf(config, name), 'data')

import { studyDir } from './store.js'
const studyDirPath = (config, name) => studyDir(config, name)

function studyDirOf(config, name) {
  const dir = studyDirPath(config, name)
  if (!existsSync(dir)) throw new Error(`调研「${name}」不存在（action=list 查看，或先 create）`)
  return dir
}

/**
 * 窗口自定：不把页数抛给用户，由 probe 按「页数预算」算出一个能跑完的窗口。
 * 预算 = 单次 fetch 的页数上限（1 页 100 帖；20 页 ≈ 2000 帖 ≈ 1.5 分钟串行）。
 * 超预算时按同一套日均数据反推最大可容纳天数（下限 7 天，再小样本就没意义了）。
 */
export const PAGE_BUDGET = 20

export function planWindow(results, days, budget = PAGE_BUDGET) {
  const usable = results.filter((r) => r.ok && typeof r.count === 'number' && r.count > 0)
  if (!usable.length) return { days, pages: 0, budget, over: false, reason: '没有可用 sub' }
  const pagesAt = (d) => usable.reduce((n, r) => n + Math.ceil(((r.count / days) * d) / 100), 0)
  let window = days
  let pages = pagesAt(window)
  if (pages > budget) {
    let lo = 7
    let hi = days
    let best = 7
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (pagesAt(mid) <= budget) { best = mid; lo = mid + 1 } else hi = mid - 1
    }
    window = Math.max(7, Math.min(days, best))
    pages = pagesAt(window)
  }
  return {
    days: window,
    pages,
    budget,
    over: pages > budget,
    shrunk: window < days,
    etaSeconds: Math.round(pages * 0.75),
  }
}

/** 探活：sub 活跃度 + 窗口样本量预估（开跑前必做，页数 = 帖量/100 向上取整）。 */
export async function probe(config, name, subs, { days = 30 } = {}) {
  const results = await probeSubs(subs, { days })
  const plan = planWindow(results, days)
  if (name) {
    const dir = studyDirPath(config, name)
    if (existsSync(dir)) {
      journal(dir, { action: 'probe', ok: true, summary: `探活 ${subs.join(', ')}（${days} 天窗口）→ 建议 ${plan.days} 天 / ${plan.pages} 页` })
      if (plan.days !== days) saveMeta(config, name, { days: plan.days, probe_plan: plan })
    }
  }
  const planText = plan.pages
    ? `窗口建议：${plan.days} 天（合计 ${plan.pages} 页 ≈ ${Math.max(1, Math.round(plan.etaSeconds / 60))} 分钟）` +
      (plan.shrunk ? `——原 ${days} 天要 ${Math.ceil(plan.pages * (days / plan.days))} 页，已按单次 ≤${plan.budget} 页预算自动缩窗，直接 fetch 即可，不要找用户确认` : '——在预算内，直接 fetch 即可，不要找用户确认')
    : '窗口建议：没有可用 sub（近窗口 0 帖/日均 <1 帖），换 sub 或放宽品类'
  return {
    ok: true,
    results,
    plan,
    summary: results.map((r) => `r/${r.sub}: ${r.verdict}${r.count !== null ? `（近${days}天 ${r.count} 帖，页数≈${Math.ceil((r.count || 0) / 100)}）` : ''}`).join('\n') + '\n' + planText,
  }
}

/** 全量拉取：一个或多个 sub（各自独立输出与日志；单 sub 分页串行）。 */
export async function fetchStudy(config, name, { subs, days, fresh = false, maxPages = 600 } = {}) {
  const dir = studyDirPath(config, name)
  const meta = readMeta(config, name)
  const window = days || meta?.days || 90
  const subList = (subs && subs.length ? subs : meta?.subs || []).map((s) => String(s).trim().replace(/^r\//i, '')).filter(Boolean)
  if (!subList.length) throw new Error('没有指定 subreddit（fetch 的 subs 参数，或创建调研时给 subs）')
  const dataDir = join(dir, 'data')
  mkdirSync(dataDir, { recursive: true })
  const results = []
  for (const sub of subList) {
    const r = await fetchSubreddit(sub, window, join(dataDir, `${sub}.json`), { fresh, maxPages })
    results.push(r)
  }
  saveMeta(config, name, { subs: [...new Set([...(meta?.subs || []), ...subList])], days: window, fetched_at: new Date().toISOString() })
  const total = results.reduce((n, r) => n + r.total, 0)
  const completeCount = results.filter((r) => r.complete).length
  journal(dir, { action: 'fetch', ok: completeCount === results.length, summary: `拉取 ${results.map((r) => `r/${r.sub}:${r.total}帖${r.complete ? '完整' : '部分'}`).join(' ')}，窗口 ${window} 天` })
  return {
    ok: true, total, complete: completeCount === results.length, window, results: results.map((r) => ({ sub: r.sub, total: r.total, pages: r.pages, complete: r.complete, stopReason: r.stopReason })),
    summary: `${completeCount}/${results.length} 个 sub 完整，共 ${total} 帖（窗口 ${window} 天）。${completeCount < results.length ? '部分数据可重跑同一命令续传。' : ''}下一步：analyze（主题表先按品类重建，短词必须加 \\b 词边界）。`,
  }
}

/** 帖级分析：五分类 + 评分卡 + 商业信号 + 数据体检 → analysis.md。 */
export function analyzeStudy(config, name, opts = {}) {
  const dir = studyDirPath(config, name)
  const dataDir = join(dir, 'data')
  const { posts } = loadPosts(dataDir)
  if (!posts.length) throw new Error('没有数据。先跑 fetch（中断/失败后重跑同一命令续传）。')
  // 主题表：调研级 themes.json（可被 opts.themes 临时覆盖）
  let themes = opts.themes
  if (!themes) {
    const tf = join(dir, 'themes.json')
    if (!existsSync(tf)) throw new Error(`调研还没有 themes.json 主题表（先 action=themes 保存，按品类重建；模板结构见 skills/reddit-research/assets）`)
    themes = JSON.parse(readFileSync(tf, 'utf8'))
  }
  const res = analyzePosts(posts, {
    themes,
    focus: opts.focus,
    focusMin: opts.focusMin,
    scope: opts.scope ?? readMeta(config, name)?.scope,
    signals: opts.signals,
    showcaseTop: opts.showcaseTop,
    promoCheck: opts.promoCheck ?? false,
  })
  const md = renderAnalysis(res, { top: opts.top })
  writeTextAtomic(join(dir, 'analysis.md'), md)
  writeJsonAtomic(join(dir, 'analysis.json'), res)
  saveMeta(config, name, { analyzed_at: new Date().toISOString(), sample: res.sample })
  journal(dir, { action: 'analyze', ok: true, summary: `分析 ${res.sample} 帖：抱怨 ${res.buckets.complaint}/求助 ${res.buckets.help}/展示 ${res.buckets.showcase}，Top30 展示帖占比 ${res.showcaseShare}%` })
  return { ok: true, result: res, md, summary: `分析完成（${res.sample} 帖）。Top30 展示帖占比 ${res.showcaseShare}%（${res.showcaseVerdict}）${res.scope ? `；相关性 ${res.scope.share}%` : ''}。评分卡 Top3：${res.scorecard.slice(0, 3).map((r) => `${r.theme}(${r.score})`).join('、') || '无主题命中——检查主题表正则'}` }
}

/** 保存主题表。 */
export function saveThemes(config, name, themes, { scope } = {}) {
  const dir = studyDirPath(config, name)
  if (!themes || typeof themes !== 'object' || Array.isArray(themes) || !Object.keys(themes).length) {
    throw new Error('themes 应为 {"主题名": "正则"} 非空对象（短词必须加 \\b 词边界）')
  }
  writeJsonAtomic(join(dir, 'themes.json'), themes)
  const patch = { themes_at: new Date().toISOString() }
  if (scope !== undefined) patch.scope = String(scope)
  saveMeta(config, name, patch)
  journal(dir, { action: 'themes', ok: true, summary: `保存主题表（${Object.keys(themes).length} 主题）${scope !== undefined ? ` + scope 正则` : ''}` })
  return { ok: true, count: Object.keys(themes).length }
}

/** 评论树补刀：对痛点/口碑层候选帖抓评论树 + 评论级分析 → comments.md。 */
export async function commentsStudy(config, name, { ids, scope, top = 5 } = {}) {
  const dir = studyDirPath(config, name)
  const analysisFile = join(dir, 'analysis.json')
  let candidateIds = ids
  if (!candidateIds && existsSync(analysisFile)) {
    candidateIds = JSON.parse(readFileSync(analysisFile, 'utf8')).commentCandidates.map((p) => p.id)
  }
  if (!candidateIds?.length) throw new Error('没有评论树候选帖：先 analyze（候选来自痛点/口碑层 top，非全局热度 top），或显式传 ids')
  const ct = await fetchCommentTrees(candidateIds, { log: () => {} })
  if (!ct.comments.length) throw new Error(`评论树抓取 0 条（${ct.posts.map((p) => `t3_${p.id}:${p.ok ? '0条' : p.error}`).join(' ')}）。注意 API 对不存在帖返回 200+空 data，与零评论帖无法区分——帖 ID 应来自 fetch 结果`)
  writeJsonAtomic(join(dir, 'comments.json'), ct.comments)
  const meta = readMeta(config, name)
  const themes = existsSync(join(dir, 'themes.json')) ? JSON.parse(readFileSync(join(dir, 'themes.json'), 'utf8')) : {}
  const res = analyzeComments(ct.comments, { themes, scope: scope ?? meta?.scope, top })
  const md = renderComments(res)
  writeTextAtomic(join(dir, 'comments.md'), md)
  writeJsonAtomic(join(dir, 'comments_analysis.json'), res)
  journal(dir, { action: 'comments', ok: true, summary: `评论树补刀 ${candidateIds.length} 帖 → ${ct.comments.length} 条干净评论；主题命中 ${Object.values(res.themes).reduce((n, t) => n + t.count, 0)} 次` })
  return { ok: true, posts: ct.posts, count: ct.comments.length, result: res, md, summary: `评论级分析完成：${ct.comments.length} 条干净评论（已剔除 [removed]/机器人）。主题命中 Top：${Object.entries(res.themes).sort((a, b) => b[1].count - a[1].count).slice(0, 3).map(([k, v]) => `${k}(${v.count})`).join('、') || '无——主题表没覆盖评论区语言，回炉扩表'}` }
}

/** 数字闭环校验：report.md 的引用 vs data/ 原始数据。 */
export function verifyStudy(config, name, { report } = {}) {
  const dir = studyDirPath(config, name)
  const reportFile = report || join(dir, 'report.md')
  if (!existsSync(reportFile)) throw new Error(`报告不存在: ${reportFile}（先让 agent 写 report.md，再 verify）`)
  const text = readFileSync(reportFile, 'utf8')
  const res = verifyCitations(text, join(dir, 'data'), { scoreTol: 0 })
  saveMeta(config, name, { verified: res.ok ? 'pass' : 'fail', verified_at: new Date().toISOString() })
  journal(dir, { action: 'verify', ok: res.ok, summary: `数字闭环${res.ok ? '通过' : '未通过'}：引用帖 ${res.checked} 个，问题 ${res.problems.length} 个` })
  return {
    ok: res.ok, checked: res.checked, dataset: res.dataset, problems: res.problems,
    summary: res.ok
      ? `✓ 数字闭环通过：${res.checked} 个引用帖全部可在数据集复算（数据集 ${res.dataset} 帖）。报告可发布。`
      : `✗ 数字闭环未通过（${res.problems.length} 个问题）——发稿前必须逐条修正，编造引用=报告无效。`,
  }
}

/** 保存报告文本（agent 写完 report 后落盘再校验）。 */
export function saveReport(config, name, text) {
  const dir = studyDirPath(config, name)
  writeTextAtomic(join(dir, 'report.md'), text)
  journal(dir, { action: 'report', ok: true, summary: `保存调研报告（${text.split('\n').length} 行）` })
  return { ok: true, file: join(dir, 'report.md') }
}

/** 读调研详情（工具 read / 面板 detail 共用）。 */
export function studyDetail(config, name) {
  const dir = studyDirPath(config, name)
  if (!existsSync(dir)) return null
  const meta = readMeta(config, name)
  const dataDir = join(dir, 'data')
  const dataFiles = existsSync(dataDir) ? readdirSync(dataDir).filter((f) => /\.json$/.test(f) && !f.endsWith('.meta')).map((f) => {
    const sub = f.replace(/\.json$/, '')
    let count = 0
    try { count = JSON.parse(readFileSync(join(dataDir, f), 'utf8')).length } catch { /* ignore */ }
    return { sub, count }
  }) : []
  const analysis = existsSync(join(dir, 'analysis.json')) ? JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8')) : null
  const commentsRes = existsSync(join(dir, 'comments_analysis.json')) ? JSON.parse(readFileSync(join(dir, 'comments_analysis.json'), 'utf8')) : null
  return {
    name, meta,
    data: dataFiles,
    total: dataFiles.reduce((n, d) => n + d.count, 0),
    has_themes: existsSync(join(dir, 'themes.json')),
    themes: existsSync(join(dir, 'themes.json')) ? JSON.parse(readFileSync(join(dir, 'themes.json'), 'utf8')) : null,
    analysis, commentsRes,
    has_report: existsSync(join(dir, 'report.md')),
    verified: meta?.verified ?? null,
    journal: readJournal(dir, 60),
  }
}

export { loadPosts, loadComments, fetchPostsByIds }
