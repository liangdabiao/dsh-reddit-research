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
  const times = posts.map((p) => p.created_utc || 0).filter(Boolean)
  const oldest = times.length ? Math.min(...times) : null
  return {
    sub: s,
    group: known?.group || null,
    posts,
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
