// Arctic Shift 档案 API 客户端（fetch_subreddit.py / comment_tree.py / probe_subreddit.py 移植）。
// 免认证；核心纪律（全部来自上游实测复盘）：
//   · 全站关键词查询（无 sub 限定）返回 400 = 请求形态不被允许 → 不重试
//   · 任何请求 422 "Timeout" = 瞬态过载 → 退避重试 3-5 次（同参重发即恢复，绝不能当永久失败）
//   · 429/5xx/连接失败 = 瞬态 → 重试；其余 4xx 快速失败
//   · 空响应按文档规则重试 3 次再判定到头（偶发瞬时空响应，不重试会静默截断数据）
//   · 单 sub 分页串行（限速+保序）；数据滞后约 36h；防卡死：连续 3 页 0 新帖终止
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const BASE = process.env.REDDIT_API_BASE || 'https://arctic-shift.photon-reddit.com'
export const UA = 'dsh-reddit-research/1.0'
const NET_RETRY = 6
const EMPTY_RETRY = 3
const PAGE_SLEEP = 350
const STALL_PAGES = 3
const SELFTEXT_MAX = 1200

export const KEEP = ['id', 'title', 'score', 'num_comments', 'created_utc', 'permalink', 'selftext', 'author', 'subreddit', 'link_flair_text']

class FetchError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const backoff = (i) => sleep(Math.min(2000 * (i + 1), 12000))

async function apiGet(url, { retries = NET_RETRY, log = () => {} } = {}) {
  let last = null
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) })
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 200)
        if (res.status === 429 || res.status === 422 || res.status >= 500) {
          last = `HTTP ${res.status}: ${body}`
          await backoff(i) // 422 "Timeout" = 瞬态过载，重试即恢复
          continue
        }
        throw new FetchError(`HTTP ${res.status}: ${body}`) // 其余 4xx 快速失败
      }
      const d = await res.json()
      if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(`响应顶层非对象: ${typeof d}`)
      if ('error' in d) throw new Error(`服务端 error: ${d.error}`)
      if (!Array.isArray(d.data)) throw new Error(`data 非列表: ${typeof d.data}`)
      return d.data
    } catch (e) {
      if (e instanceof FetchError) throw e
      last = `${e?.name || 'Error'}: ${e?.message || e}`
      await backoff(i)
    }
  }
  throw new Error(`重试 ${retries} 次仍失败: ${last}`)
}

const trimPost = (p) => {
  const o = {}
  for (const k of KEEP) o[k] = p[k] ?? null
  o.selftext = typeof o.selftext === 'string' ? o.selftext.slice(0, SELFTEXT_MAX) : ''
  return o
}

/** 原子写 JSON（临时文件 + rename）。 */
export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value), 'utf8')
  renameSync(tmp, file)
}

// ── probe：sub 活跃度探测（最新帖时间 + 近 N 天精确帖量）──────────────────────
export async function probeSubs(subs, { days = 30, log = console.log } = {}) {
  const out = []
  for (const raw of subs) {
    const sub = String(raw).trim().replace(/^r\//i, '')
    const q = encodeURIComponent(sub)
    const r = { sub, ok: false, newest_day: null, newest_title: null, age_days: null, count: null, per_day: null, verdict: '' }
    try {
      const data = await apiGet(`${BASE}/api/posts/search?subreddit=${q}&limit=1&sort=desc`, { log })
      if (data.length && typeof data[0] === 'object') {
        r.ok = true
        r.newest_title = String(data[0].title || '').slice(0, 60)
        const u = data[0].created_utc || 0
        r.newest_day = new Date(u * 1000).toISOString().slice(0, 10)
        r.age_days = Math.max(0, Math.floor((Date.now() / 1000 - u) / 86400))
      }
    } catch (e) {
      r.error = `最新帖查询失败: ${e.message}`
      out.push(r)
      continue
    }
    try {
      const now = Math.floor(Date.now() / 1000)
      const after = now - days * 86400
      const data = await apiGet(`${BASE}/api/posts/search/aggregate?subreddit=${q}&aggregate=subreddit&after=${after}&before=${now}`, { log })
      if (Array.isArray(data) && data.length && typeof data[0] === 'object') {
        r.count = parseInt(data[0].count, 10) || 0 // count 是字符串
        r.per_day = +(r.count / days).toFixed(1)
      } else if (Array.isArray(data)) {
        r.count = 0
        r.per_day = 0
      }
    } catch (e) {
      r.error = `aggregate 失败: ${e.message}`
    }
    if (!r.ok) r.verdict = '✗ 无任何帖子 — sub 可能不存在或拼错'
    else if (r.count === 0) r.verdict = '✗ 近窗口 0 帖 → 疑似停更/不存在，不可用于结论'
    else if (r.count !== null && r.count < days) r.verdict = '⚠ 日均不足 1 帖 → 低活跃，考虑换 sub 或拉长时间窗'
    else if (r.age_days > 90) r.verdict = '⚠ 最新帖已 90+ 天前 → 数据陈旧'
    else r.verdict = '✓ 活跃度可用'
    out.push(r)
    await sleep(PAGE_SLEEP)
  }
  if (log) {
    for (const r of out) {
      log(`r/${r.sub}: ${r.ok ? `最新帖 ${r.newest_day}${r.count !== null ? ` | 近${days}天 ${r.count} 帖 (日均 ${r.per_day})` : ''}` : r.error || '查询失败'}\n  ${r.verdict}`)
    }
  }
  return out
}

// ── fetch：全量分页拉取（增量落盘 + 断点续传 + 原子合并）────────────────────────
const sidePaths = (outFile) => {
  const base = outFile.replace(/\.json$/i, '')
  return { jsonl: base + '.jsonl', meta: base + '.meta', log: base + '.log' }
}

function loadCheckpoint(jsonlFile) {
  const seen = new Set()
  let oldest = null
  let bad = 0
  if (existsSync(jsonlFile)) {
    for (const line of readFileSync(jsonlFile, 'utf8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const p = JSON.parse(s)
        if (p && typeof p === 'object' && p.id) {
          seen.add(p.id)
          const u = p.created_utc || 0
          oldest = oldest === null ? u : Math.min(oldest, u)
        }
      } catch { bad++ }
    }
  }
  return { seen, oldest, bad }
}

function mergeFinal(jsonlFile, outFile, cutoff) {
  const seen = new Set()
  const uniq = []
  let bad = 0
  for (const line of readFileSync(jsonlFile, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s) continue
    let p
    try { p = JSON.parse(s) } catch { bad++; continue }
    if (!p || typeof p !== 'object' || !p.id || seen.has(p.id)) continue
    seen.add(p.id)
    if ((p.created_utc || 0) >= cutoff) uniq.push(p)
  }
  uniq.sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0))
  writeJsonAtomic(outFile, uniq)
  return { total: uniq.length, bad }
}

/**
 * 全量拉取一个 sub 的窗口内帖子。
 * @returns { ok, complete, total, pages, stopReason, out, jsonl, meta, logFile }
 */
export async function fetchSubreddit(sub, days, outFile, { fresh = false, quiet = true, onProgress, maxPages = 600 } = {}) {
  sub = String(sub).trim().replace(/^r\//i, '')
  const q = encodeURIComponent(sub)
  const { jsonl, meta, log: logFile } = sidePaths(outFile)
  mkdirSync(dirname(outFile), { recursive: true })
  const logs = []
  const log = (m) => {
    logs.push(m)
    if (!quiet) console.log(m)
    try { appendFileSync(logFile, `${new Date().toISOString().slice(11, 19)} ${m}\n`, 'utf8') } catch { /* ignore */ }
  }

  // 窗口：首跑定死写入 meta（续传沿用，避免 cutoff 漂移）；fresh 清空断点重抓
  const now = Math.floor(Date.now() / 1000)
  let cutoff = now - days * 86400
  if (fresh) {
    for (const f of [jsonl, meta]) { try { rmSync(f, { force: true }) } catch { /* ignore */ } }
  }
  if (existsSync(meta)) {
    try {
      const m = JSON.parse(readFileSync(meta, 'utf8'))
      if (String(m.subreddit || '').toLowerCase() !== sub.toLowerCase()) {
        throw new Error(`meta 记录的 sub 是 r/${m.subreddit}，与本次 r/${sub} 不符。换输出路径或 fresh 重抓`)
      }
      cutoff = m.cutoff
    } catch (e) {
      throw new Error(`meta 损坏（${e.message}）。删除 ${meta} 或加 fresh 重跑`)
    }
  } else {
    writeJsonAtomic(meta, { subreddit: sub, days, cutoff, started_utc: now, started: new Date().toISOString() })
  }

  const cp = loadCheckpoint(jsonl)
  if (cp.bad) log(`  [warn] checkpoint 有 ${cp.bad} 行坏数据（崩溃残留），已跳过`)
  let before = cp.oldest !== null ? cp.oldest - 1 : null
  log(`[r/${sub}] 窗口 ${days} 天 (cutoff=${cutoff}, ${new Date(cutoff * 1000).toISOString().slice(0, 10)} 起)` +
    (cp.oldest !== null ? ` | 断点续传: 已有 ${cp.seen.size} 帖` : ''))

  let pages = 0
  let emptyStreak = 0
  let stall = 0
  let complete = false
  let stopReason = ''
  if (cp.oldest !== null && cp.oldest < cutoff) {
    complete = true
    stopReason = '断点已越过 cutoff，直接合并'
  }
  try {
    while (!complete && pages < maxPages) {
      const url = `${BASE}/api/posts/search?subreddit=${q}&limit=100&sort=desc${before !== null ? `&before=${before}` : ''}`
      let data
      try {
        data = await apiGet(url, { log })
      } catch (e) {
        stopReason = `网络放弃: ${e.message}`
        log(`  [fatal] ${stopReason} — 已增量保存 ${cp.seen.size} 帖，重跑同一命令即可续传`)
        break
      }
      if (!data.length) {
        emptyStreak++
        if (emptyStreak <= EMPTY_RETRY) {
          log(`  [warn] 空响应 (第 ${emptyStreak}/${EMPTY_RETRY} 次)，重试`)
          await sleep(2000 * emptyStreak)
          continue
        }
        complete = true
        stopReason = '数据到头（空响应）'
        break
      }
      emptyStreak = 0
      pages++
      const posts = []
      let skipped = 0
      for (const p of data) {
        if (p && typeof p === 'object' && !Array.isArray(p)) posts.push(trimPost(p))
        else skipped++
      }
      let freshN = 0
      let chunk = ''
      for (const t of posts) {
        if (!t.id || cp.seen.has(t.id)) continue
        cp.seen.add(t.id)
        chunk += JSON.stringify(t) + '\n'
        freshN++
      }
      if (chunk) appendFileSync(jsonl, chunk, 'utf8')
      if (skipped) log(`  [warn] 本页跳过 ${skipped} 个非 dict 畸形元素`)

      const times = posts.map((t) => t.created_utc || 0)
      const oldest = times.length ? Math.min(...times) : 0
      const oldestDay = oldest ? new Date(oldest * 1000).toISOString().slice(0, 10) : '?'
      log(`  page ${String(pages).padStart(4)} | raw=${String(data.length).padStart(3)} new=${String(freshN).padStart(3)} total=${String(cp.seen.size).padStart(6)} oldest=${oldestDay}`)
      onProgress?.({ pages, total: cp.seen.size, oldestDay })

      if (oldest && oldest < cutoff) {
        complete = true
        stopReason = `已拉过 cutoff（${oldestDay} < 窗口起点）`
        break
      }
      stall = freshN === 0 ? stall + 1 : 0
      if (stall >= STALL_PAGES) {
        stopReason = `连续 ${STALL_PAGES} 页 0 新帖，判定服务端分页异常，终止`
        log(`  [warn] ${stopReason}`)
        break
      }
      before = oldest - 1
      await sleep(PAGE_SLEEP)
    }
  } catch (e) {
    stopReason = `异常中断: ${e.message}`
  }
  if (pages >= maxPages && !complete) stopReason = stopReason || `达到 maxPages=${maxPages} 上限（可用 fresh+更大 maxPages 续）`

  const merged = mergeFinal(jsonl, outFile, cutoff)
  if (merged.bad) log(`  [warn] 合并时跳过 ${merged.bad} 行坏数据`)
  log(`[r/${sub}] ${complete ? '完整完成' : '部分数据（可续传）'}: ${merged.total} 帖 / ${pages} 页 | 原因: ${stopReason} -> ${outFile}`)
  return {
    ok: true, complete, total: merged.total, pages, stopReason,
    out: outFile, jsonl, meta, logFile, logs, sub, cutoff,
  }
}

// ── comment_tree：评论树抓取（批量多帖；剔除 [removed]/机器人）──────────────────
const REMOVED_BODIES = ['[removed]', '[deleted]']

export function isNoiseComment(c) {
  const body = String(c?.body || '').trim().toLowerCase()
  if (REMOVED_BODIES.includes(body)) return true
  const author = String(c?.author || '').toLowerCase()
  return author === 'automoderator' || author.endsWith('_bot')
}

function flattenTree(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) flattenTree(n, out)
  } else if (node && typeof node === 'object') {
    if (node.kind === 'more' || node.type === 'more') return // 折叠对象不带正文
    if (node.data && typeof node.data === 'object' && !Array.isArray(node.data)) flattenTree(node.data, out)
    else if (node.id && (node.body !== undefined || node.score !== undefined)) out.push(node)
    if (Array.isArray(node.children)) flattenTree(node.children, out)
    if (Array.isArray(node.replies)) flattenTree(node.replies, out)
  }
}

/**
 * 抓多帖评论树。逐帖串行（限速），单帖失败不影响其余。
 * @returns { ok, posts:[{id, ok, count, error}], comments 去重后的干净评论数组 }
 */
export async function fetchCommentTrees(ids, { log = () => {}, maxPerPost = 500 } = {}) {
  const results = []
  const seen = new Set()
  const comments = []
  for (const pid of ids) {
    const id = String(pid).trim().replace(/^t3_/i, '')
    if (!id) continue
    try {
      const data = await apiGet(`${BASE}/api/comments/tree?link_id=t3_${id}`, { log })
      const flat = []
      flattenTree(data, flat)
      let n = 0
      for (const c of flat) {
        if (!c || typeof c !== 'object' || !c.id || seen.has(c.id)) continue
        if (isNoiseComment(c)) continue
        seen.add(c.id)
        comments.push(c)
        n++
        if (n >= maxPerPost) break
      }
      results.push({ id, ok: true, count: n })
      log(`  t3_${id}: ${n} 条干净评论`)
    } catch (e) {
      results.push({ id, ok: false, count: 0, error: e.message })
      log(`  t3_${id}: ✗ ${e.message}`)
    }
    await sleep(PAGE_SLEEP)
  }
  return { ok: results.some((r) => r.ok), posts: results, comments }
}

/** 按 ID 批量取帖子（/api/posts/ids，每次 ≤500）。 */
export async function fetchPostsByIds(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const data = await apiGet(`${BASE}/api/posts/ids?ids=${chunk.join(',')}`)
    for (const p of data) if (p && typeof p === 'object') out.push(trimPost(p))
    await sleep(PAGE_SLEEP)
  }
  return out
}
