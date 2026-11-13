// 数字闭环校验器（verify_citations.py 移植）：
// 报告里每个引用帖的 ID 是否存在于数据集、score/comments/日期是否与数据一致。
// exit 语义 = { ok:false, problems } —— 有编造或抄错的引用必须清零再发。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join as joinPath } from 'node:path'
import { dayOf } from './analyze.js'

const LINK_RX = /https?:\/\/(?:www\.)?reddit\.com\/r\/[^/\s]+\/comments\/([A-Za-z0-9]+)(?:\/[^/\s]*)?\/?/g
const CLAIM_RX = /score\s*[:：]?\s*(\d+)\s*[,，/·\s]+comments\s*[:：]?\s*(\d+)/gi
const FMT2_RX = /score\s+(\d+)\s*·\s*(\d+)\s*评论/gi
const DATE_RX = /(\d{4}-\d{2}-\d{2})/g
const BRACKET_ID_RX = /\[([A-Za-z0-9]{6,10})\](?!\()/g

export function loadPostsSameAs(dataDir) {
  const posts = []
  const seen = new Set()
  const patterns = []
  try {
    if (statSync(dataDir).isDirectory()) {
      patterns.push(...readdirSync(dataDir).filter((f) => /\.json$/i.test(f)).sort().map((f) => joinPath(dataDir, f)))
      patterns.push(...readdirSync(dataDir).filter((f) => /\.jsonl$/i.test(f)).sort().map((f) => joinPath(dataDir, f)))
    } else patterns.push(String(dataDir))
  } catch { /* 空 */ }
  for (const f of patterns) {
    if (/\.meta$/.test(f)) continue
    let cut = null
    const metaFile = joinPath(dirname(f), basename(f).replace(/\.jsonl?$/i, '') + '.meta')
    try {
      if (existsSync(metaFile)) cut = Number(JSON.parse(readFileSync(metaFile, 'utf8')).cutoff) || null
    } catch { /* ignore */ }
    let items = null
    try {
      if (/\.jsonl$/i.test(f)) {
        items = []
        for (const line of readFileSync(f, 'utf8').split('\n')) {
          const s = line.trim()
          if (!s) continue
          try { items.push(JSON.parse(s)) } catch { /* ignore */ }
        }
      } else {
        const d = JSON.parse(readFileSync(f, 'utf8'))
        if (Array.isArray(d)) items = d
      }
    } catch { continue }
    if (!items) continue
    for (const p of items) {
      if (!p || typeof p !== 'object' || !p.id || seen.has(p.id)) continue
      if (cut !== null && (p.created_utc || 0) < cut) continue
      seen.add(p.id)
      posts.push(p)
    }
  }
  return posts
}

/**
 * 校验报告 markdown vs 数据目录。
 * @param opts { scoreTol=0 }
 * @returns { ok, checked, dataset, problems[] }
 */
export function verifyCitations(reportText, dataDir, { scoreTol = 0 } = {}) {
  const posts = loadPostsSameAs(dataDir)
  if (!posts.length) throw new Error(`数据目录没有可用数据: ${dataDir}`)
  const byId = new Map(posts.map((p) => [p.id, p]))
  const problems = []
  const checked = new Set()

  let pendingClaim = null // analyze fmt 风格：score 行在链接上一行
  let pendingDate = null
  for (const line of reportText.split('\n')) {
    const links = [...line.matchAll(LINK_RX)]
    const claims = [...line.matchAll(CLAIM_RX), ...line.matchAll(FMT2_RX)].sort((a, b) => a.index - b.index)
    const dates = [...line.matchAll(DATE_RX)]

    if (!links.length) {
      pendingClaim = claims.length ? [Number(claims[claims.length - 1][1]), Number(claims[claims.length - 1][2])] : null
      pendingDate = dates.length ? dates[dates.length - 1][1] : null
      continue
    }
    const n = claims.length ? Math.min(links.length, claims.length) : 0
    links.forEach((m, i) => {
      const pid = m[1]
      checked.add(pid)
      const p = byId.get(pid)
      if (!p) {
        problems.push(`✗ 帖 ${pid} 不在数据集中（疑似编造引用或数据目录给错）`)
        problems.push(`    行: ${line.trim().slice(0, 120)}`)
        return
      }
      let claim = null
      if (i < n) claim = [Number(claims[i][1]), Number(claims[i][2])]
      else if (!claims.length && pendingClaim && i === 0) claim = pendingClaim
      if (claim) {
        const [cs, cc] = claim
        if (p.score !== null && p.score !== undefined && Math.abs(cs - p.score) > scoreTol) {
          problems.push(`✗ 帖 ${pid} score 不符: 报告=${cs} 数据=${p.score}`)
        }
        if (p.num_comments !== null && p.num_comments !== undefined && cc !== p.num_comments) {
          problems.push(`✗ 帖 ${pid} comments 不符: 报告=${cc} 数据=${p.num_comments}`)
        }
      }
      const dm = i < dates.length ? dates[i][1] : (i === 0 && !dates.length ? pendingDate : null)
      if (dm && p.created_utc && dm !== dayOf(p.created_utc)) {
        problems.push(`✗ 帖 ${pid} 日期不符: 报告=${dm} 数据=${dayOf(p.created_utc)}`)
      }
    })
    pendingClaim = null
    pendingDate = null
  }

  // 强制格式里的 [帖ID]（防只写 ID 不写链接漏检）
  for (const m of reportText.matchAll(BRACKET_ID_RX)) {
    const pid = m[1]
    if (checked.has(pid)) continue
    if (!/^[a-z0-9]{6,10}$/.test(pid)) continue
    checked.add(pid)
    if (!byId.has(pid)) problems.push(`✗ 引用 [${pid}] 不在数据集中（疑似编造或 ID 抄错）`)
  }

  return { ok: problems.length === 0, checked: checked.size, dataset: posts.length, problems }
}
