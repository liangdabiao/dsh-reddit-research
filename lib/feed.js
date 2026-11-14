// 海外动态 · 16 个精选 Reddit 社区目录 + 最新帖流（分页加载）。
// 数据源同 Arctic Shift（免认证，滞后约 36h）；分页用 before 游标（上一页最老帖的 created_utc-1）。
// 判读纪律与抓取共用 lib/reddit.js 的 apiGet（422 退避 / 400 快败 / 空响应重试）。
import { BASE, apiGet, trimPost } from './reddit.js'

/** 16 个值得关注的社区（创业/SaaS · 营销/SEO · 应用/AI 开发），月访问量为参考值。 */
export const FEED_SUBS = [
  // 创业 / SaaS
  { sub: 'saas', visits: '110万+', desc: 'SaaS产品、创业经验、产品增长', group: '创业 · SaaS' },
  { sub: 'founder', visits: '21.6万+', desc: '创始人交流、创业经验、商业增长', group: '创业 · SaaS' },
  { sub: 'sideproject', visits: '130万+', desc: '副业项目、独立开发、产品展示', group: '创业 · SaaS' },
  { sub: 'microsaas', visits: '6.8万+', desc: '微型SaaS、独立开发、产品变现', group: '创业 · SaaS' },
  { sub: 'micro_saas', visits: '18万+', desc: '微型SaaS、产品增长、独立创业', group: '创业 · SaaS' },
  { sub: 'entrepreneur', visits: '74.4万+', desc: '创业经验、商业模式、企业经营', group: '创业 · SaaS' },
  { sub: 'startups', visits: '30.8万+', desc: '初创企业、融资、产品冷启动', group: '创业 · SaaS' },
  // 营销 / SEO
  { sub: 'agency', visits: '1.4万+', desc: '营销代理、客户开发、Agency运营', group: '营销 · SEO' },
  { sub: 'bigseo', visits: '2万+', desc: 'Google SEO、搜索引擎优化、技术交流', group: '营销 · SEO' },
  { sub: 'marketing', visits: '27.2万+', desc: '数字营销、品牌推广、增长策略', group: '营销 · SEO' },
  { sub: 'blogging', visits: '1.4万+', desc: '博客运营、内容营销、流量增长', group: '营销 · SEO' },
  { sub: 'juststart', visits: '1.4万+', desc: '内容网站、SEO实践、网站变现', group: '营销 · SEO' },
  // 应用 / AI 开发
  { sub: 'macapps', visits: '57.6万+', desc: 'Mac应用、软件推荐、产品反馈', group: '应用 · AI 开发' },
  { sub: 'apps', visits: '14万+', desc: 'App推荐、应用发现、产品讨论', group: '应用 · AI 开发' },
  { sub: 'imadethis', visits: '10.4万+', desc: '创意作品、产品展示、用户反馈', group: '应用 · AI 开发' },
  { sub: 'vibecoding', visits: '140万+', desc: 'AI编程、Vibe Coding、AI产品开发', group: '应用 · AI 开发' },
]

export const FEED_GROUPS = ['创业 · SaaS', '营销 · SEO', '应用 · AI 开发']

const PAGE_SLEEP = 350

// 已删/已移除的占位帖：标题就是状态文本，没有任何信息量。
const REMOVED_TITLES = new Set([
  '[removed]', '[deleted]', '[ removed by moderator ]', '[removed by moderator]',
  '[ removed by reddit ]', '[removed by reddit]', '[ removed ]',
])

/** 标题归一化：去标签、去社区强制的 "I will not promote" 尾巴、去标点与多余空白。 */
export function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ') // [I will not promote] / [Removed by moderator]
    .replace(/\bi\s*(?:will|won'?t)\s*not\s*promote\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function isRemovedPost(p) {
  const t = String(p?.title || '').trim().toLowerCase()
  if (REMOVED_TITLES.has(t)) return true
  // 标题只剩社区强制尾巴（"I will not promote"）或纯符号：等于没标题，不进 feed
  return normalizeTitle(t) === ''
}

/** 互动强度：评论权重高于点赞（有讨论才是有信息量的那条）。 */
const weight = (p) => (Number(p?.score) || 0) + 3 * (Number(p?.num_comments) || 0)

// 同作者连发判定窗口：feed 是"最新帖流"摘要，同一人 6 小时内发多条基本是刷量/换标题重发。
const BURST_SECONDS = 6 * 3600

/**
 * 折叠近似重复帖。r/startups 等社区存在同一账号几分钟内连发同一标题的刷量行为
 * （Arctic Shift 会如实返回每条独立 post id），以及分页边界同一秒帖被重复取回。
 * 判据三条，逐条收紧：
 *   1) post id 完全相同（分页重叠）
 *   2) 同一作者 + 归一化标题相同（换大小写/标点/“I will not promote”尾巴）
 *   3) 同一作者 + 6 小时内连发（换标题重发同一条内容）
 * 保留互动最高的那条，位次不变。
 */
export function collapseDuplicates(posts) {
  const byId = new Set()
  const slot = new Map() // key -> out 数组下标
  const out = []
  let collapsed = 0
  for (const p of posts) {
    if (!p || typeof p !== 'object') continue
    if (isRemovedPost(p)) { collapsed++; continue }
    if (p.id && byId.has(p.id)) { collapsed++; continue }
    const key = `${String(p.author || '').toLowerCase()}|${normalizeTitle(p.title)}`
    const at = slot.get(key)
    if (at === undefined) {
      slot.set(key, out.length)
      out.push(p)
      if (p.id) byId.add(p.id)
      continue
    }
    collapsed++
    // 保留互动最高的那条；打平时留先出现的（通常是最早发布那条）
    if (weight(p) > weight(out[at])) out[at] = p
    if (out[at].id) byId.add(out[at].id)
  }
  // 第三轮：同作者 6 小时连发（标题不同的换皮重发）
  const kept = []
  let burst = 0
  for (const p of out) {
    const author = String(p.author || '').toLowerCase()
    const t = Number(p.created_utc) || 0
    let dupAt = -1
    for (let i = 0; i < kept.length; i++) {
      const q = kept[i]
      if (String(q.author || '').toLowerCase() !== author) continue
      if (Math.abs((Number(q.created_utc) || 0) - t) <= BURST_SECONDS) { dupAt = i; break }
    }
    if (dupAt === -1) { kept.push(p); continue }
    burst++
    if (weight(p) > weight(kept[dupAt])) kept[dupAt] = p
  }
  return { posts: kept, collapsed: collapsed + burst, burst }
}

/** 拉一个社区的一页最新帖（limit ≤100）。before = 上一页最老帖 created_utc-1，缺省从头。 */
export async function fetchFeedPage(sub, { before, limit = 100 } = {}) {
  const s = String(sub).trim().replace(/^r\//i, '')
  if (!s) throw new Error('sub 不能为空')
  const known = FEED_SUBS.find((x) => x.sub.toLowerCase() === s.toLowerCase())
  const q = encodeURIComponent(s)
  const l = Math.max(1, Math.min(100, Number(limit) || 100))
  const data = await apiGet(
    `${BASE}/api/posts/search?subreddit=${q}&limit=${l}&sort=desc${before ? `&before=${Number(before)}` : ''}`,
  )
  const posts = []
  for (const p of data) {
    if (p && typeof p === 'object' && !Array.isArray(p)) posts.push(trimPost(p))
  }
  // 游标必须用原始帖算：折叠只影响展示，不能让分页跳过重复帖之后的内容
  const times = posts.map((p) => p.created_utc || 0).filter(Boolean)
  const oldest = times.length ? Math.min(...times) : null
  const deduped = collapseDuplicates(posts)
  return {
    sub: s,
    group: known?.group || null,
    posts: deduped.posts,
    collapsed: deduped.collapsed,
    nextBefore: oldest !== null && posts.length >= l ? oldest - 1 : null, // 满页才有下一页
  }
}

/** 批量拉多个社区的最新一页（各 1 页、串行限速；面板「全部动态」混排用）。 */
export async function fetchFeedMulti(subs, { limit = 25 } = {}) {
  const out = []
  for (const s of subs) {
    try {
      const r = await fetchFeedPage(s, { limit })
      out.push({ ok: true, ...r })
    } catch (e) {
      out.push({ ok: false, sub: s, error: e.message })
    }
    await new Promise((r2) => setTimeout(r2, PAGE_SLEEP))
  }
  return out
}
