// 评论级分析（analyze_comments.py 移植）：
// 评论主题频次（"多少人开帖说" × "多少人共鸣"）+ 商业信号统计 + 每主题代表引语（score 排序带原楼链接）。
import { basename, dirname, join as joinPath } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { compileMap, DEFAULT_SIGNALS, dayOf } from './analyze.js'

const REMOVED_BODIES = ['[removed]', '[deleted]']

export function isNoise(c) {
  const body = String(c?.body || '').trim().toLowerCase()
  if (REMOVED_BODIES.includes(body)) return true
  const author = String(c?.author || '').toLowerCase()
  return author === 'automoderator' || author.endsWith('_bot')
}

export function loadComments(paths) {
  const files = []
  for (const p of paths) {
    try {
      if (statSync(p).isDirectory()) {
        files.push(...readdirSync(p).filter((f) => /\.json$/i.test(f) && !f.endsWith('.meta')).sort().map((f) => joinPath(p, f)))
      } else files.push(String(p))
    } catch { /* 跳过 */ }
  }
  const seen = new Set()
  const out = []
  for (const f of files) {
    let d
    try { d = JSON.parse(readFileSync(f, 'utf8')) } catch { continue }
    if (!Array.isArray(d)) continue
    for (const c of d) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue
      if (!c.id || seen.has(c.id) || isNoise(c)) continue
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}

export function commentLink(c) {
  if (c.permalink) return 'https://www.reddit.com' + c.permalink
  const parent = String(c.link_id || '').replace(/^t3_/i, '')
  return parent ? `https://www.reddit.com/comments/${parent}/_/${c.id}` : ''
}

export function fmtComment(c, i, maxlen = 400) {
  const body = String(c.body || '').replace(/\s+/g, ' ').trim()
  const score = c.score ?? '?'
  const prefix = i ? `${i}. ` : ''
  return `${prefix}"${body.slice(0, maxlen)}" — u/${c.author} · score ${score} · ${dayOf(c.created_utc)}\n   ${commentLink(c)}`
}

/**
 * 评论级分析。
 * @param opts { themes:{"名":"正则"}, scope?, signals?, top=5 }
 */
export function analyzeComments(comments, opts = {}) {
  const themes = compileMap(opts.themes || {}, '主题表')
  const signals = opts.signals ? compileMap(opts.signals, '商业信号表') : compileMap(DEFAULT_SIGNALS, '商业信号表')
  const topN = opts.top ?? 5

  let cs = comments
  let scope = null
  if (opts.scope) {
    const srx = new RegExp(opts.scope, 'i')
    const before = cs.length
    cs = cs.filter((c) => srx.test(c.body || ''))
    scope = { before, after: cs.length }
    if (!cs.length) throw new Error(`scope 过滤后 0 条——检查 scope 正则或评论数据是否与调研目标相关（过滤前 ${before} 条）`)
  }

  const themeHits = {}
  for (const [name, r] of Object.entries(themes)) themeHits[name] = cs.filter((c) => r.test(c.body || ''))
  const signalHits = {}
  for (const [name, r] of Object.entries(signals)) signalHits[name] = cs.filter((c) => r.test(c.body || ''))

  const ts = cs.map((c) => c.created_utc || 0).filter(Boolean)
  const unmatched = cs.length - new Set(Object.values(themeHits).flat().map((c) => c.id)).size

  return {
    sample: cs.length,
    scope,
    span: ts.length ? { from: dayOf(Math.min(...ts)), to: dayOf(Math.max(...ts)) } : null,
    themes: Object.fromEntries(Object.entries(themeHits).map(([k, v]) => [k, {
      count: v.length,
      share: cs.length ? +(v.length * 100 / cs.length).toFixed(1) : 0,
      top: [...v].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, topN),
    }])),
    unmatched,
    signals: Object.fromEntries(Object.entries(signalHits).map(([k, v]) => [k, {
      count: v.length,
      share: cs.length ? +(v.length * 100 / cs.length).toFixed(1) : 0,
      top: [...v].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, topN),
    }])),
  }
}

export function renderComments(res) {
  const L = ['# 评论级分析', '', `**样本** ${res.sample} 条评论${res.span ? ` · ${res.span.from} .. ${res.span.to}` : ' · 时间未知'}`]
  if (res.scope) L.push(`**scope**: 已按调研目标正则过滤（${res.scope.before} → ${res.scope.after} 条）`)
  L.push('', '## 主题频次（评论级）', '', '| 主题 | 评论数 | 占比 |', '|---|---:|---:|')
  const rows = Object.entries(res.themes).sort((a, b) => b[1].count - a[1].count)
  for (const [k, v] of rows) L.push(`| ${k} | ${v.count} | ${v.share}% |`)
  L.push('', `> 未命中任何主题的评论 ${res.unmatched} 条——占比高说明主题表没覆盖评论区语言，回炉扩表。`)

  if (rows.length) {
    L.push('', '## 各主题代表评论（score 排序）', '')
    for (const [name, v] of rows) {
      if (!v.count) continue
      L.push(`### ${name}（${v.count} 条）`, '')
      v.top.forEach((c, i) => L.push(fmtComment(c, i + 1), ''))
    }
  }

  L.push('', '## 商业信号（评论级）', '', '| 信号 | 评论数 | 占比 |', '|---|---:|---:|')
  for (const [k, v] of Object.entries(res.signals)) L.push(`| ${k} | ${v.count} | ${v.share}% |`)
  L.push('', '> 付费意愿与购买意图是机会评估的规模证据；弃用/退货是风险与竞品切入口。')
  for (const [name, v] of Object.entries(res.signals)) {
    if (!v.count) continue
    L.push(`### ${name}（${v.count} 条）`, '')
    v.top.forEach((c, i) => L.push(fmtComment(c, i + 1), ''))
  }
  return L.join('\n')
}
