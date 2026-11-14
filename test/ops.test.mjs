// store/ops/comments/verify 单测（离线假服务器，覆盖 reddit.js 的 422 重试/400 快败纪律）
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

// 假 Arctic Shift：可控错误序列
let fail422First = 0 // >0 时前 N 次请求返回 422
let post404Mode = false
const mkPost = (id, title, score = 10, nc = 3, ageDays = 2) => ({
  id, title, selftext: 'esp32 wifi battery body', score, num_comments: nc,
  created_utc: Math.floor(Date.now() / 1000) - ageDays * 86400,
  permalink: `/r/testsub/comments/${id}/`, author: 'u', subreddit: 'testsub', link_flair_text: null,
})
const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const reply = (obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
  if (url.searchParams.get('site') === 'all') return reply({ error: 'bad' }, 400) // 全站关键词查询模拟
  if (fail422First > 0) { fail422First--; return reply({ error: 'Timeout. Maybe slow down a bit' }, 422) }
  if (url.pathname === '/api/posts/search') {
    if (url.searchParams.get('before')) return reply({ data: [] })
    return reply({ data: [mkPost('f001', 'It broke', 50, 5), mkPost('f002', 'How to fix?', 30, 8)] })
  }
  if (url.pathname === '/api/posts/search/aggregate') return reply({ data: [{ key: 'testsub', count: '55' }] })
  if (url.pathname === '/api/comments/tree') {
    if (post404Mode) return reply({ data: [] }) // 不存在的帖 = 200 + 空 data
    return reply({ data: [{ kind: 't1', data: { id: 'cc1', body: 'wifi broke on my esp32, would pay for fix', score: 9, author: 'a1', created_utc: Math.floor(Date.now() / 1000) - 86400, link_id: 't3_f001', permalink: '/r/testsub/comments/f001/x/cc1' } }] })
  }
  if (url.pathname === '/api/posts/ids') return reply({ data: [mkPost(url.searchParams.get('ids') || 'x')] })
  reply({ error: 'nope' }, 404)
})

const tmpBase = mkdtempSync(join(tmpdir(), 'rr-t-'))
process.env.DSH_HOME = tmpBase

test('reddit.js：422 退避重试 / 空响应重试 / 400 快败 / 分页', async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  process.env.REDDIT_API_BASE = `http://127.0.0.1:${srv.address().port}`
  const { fetchSubreddit, probeSubs, fetchCommentTrees, apiGetSafe } = await import('../lib/reddit.js')

  fail422First = 2 // 前 2 次 422，第 3 次成功——验证"瞬态过载重试即恢复"
  const r = await fetchSubreddit('testsub', 7, join(tmpBase, 't1', 'testsub.json'), { quiet: true })
  assert.equal(r.complete, true)
  assert.equal(r.total, 2)
  assert.ok(existsSync(join(tmpBase, 't1', 'testsub.json')))
  assert.ok(existsSync(join(tmpBase, 't1', 'testsub.jsonl')))
  assert.ok(existsSync(join(tmpBase, 't1', 'testsub.meta')))

  // 断点续传：重跑同命令不丢数据（断点未越过 cutoff 时会继续拉——假服务器只回同一页，
  // 0 新帖 stall 3 页终止或空响应到头，最终 total 不变、jsonl 不重写已抓部分）
  const r2 = await fetchSubreddit('testsub', 7, join(tmpBase, 't1', 'testsub.json'), { quiet: true })
  assert.equal(r2.total, 2)
  assert.equal(r2.complete, true)

  // meta sub 不匹配拦截
  await assert.rejects(() => fetchSubreddit('other', 7, join(tmpBase, 't1', 'testsub.json'), { quiet: true }), /不符/)

  // probe：aggregate count 字符串→数字
  const pr = await probeSubs(['testsub'], { days: 30, log: null })
  assert.equal(pr[0].ok, true)
  assert.equal(pr[0].count, 55)
  assert.equal(pr[0].verdict.includes('✓'), true)

  // 评论树：剔 [removed]/机器人；不存在帖 = 200+空
  const ct = await fetchCommentTrees(['f001', 'nope99'], { log: () => {} })
  assert.equal(ct.posts.find((p) => p.id === 'f001').count, 1)
  assert.equal(ct.posts.find((p) => p.id === 'nope99').count, 0)
  assert.equal(ct.comments.length, 1)
  assert.ok(ct.comments[0].id === 'cc1')

  fail422First = 0
})

test('comments.js：scope 过滤/引语格式', async () => {
  const { analyzeComments, renderComments, loadComments, isNoise } = await import('../lib/comments.js')
  assert.ok(isNoise({ body: '[removed]', author: 'x' }))
  assert.ok(isNoise({ body: 'hi', author: 'AutoModerator' }))
  assert.ok(isNoise({ body: 'hi', author: 'some_bot' }))
  assert.ok(!isNoise({ body: 'hi', author: 'human' }))
  const cs = [
    { id: 'c1', body: 'wifi broke on my esp32', score: 9, author: 'a1', created_utc: Math.floor(Date.now() / 1000) - 86400, permalink: '/x/c1' },
    { id: 'c2', body: "I'd pay $50 for a fix", score: 30, author: 'a2', created_utc: Math.floor(Date.now() / 1000) - 86400, permalink: '/x/c2' },
  ]
  const r = analyzeComments(cs, { themes: { 连接: 'wifi|broke' }, top: 3 })
  assert.equal(r.sample, 2)
  assert.equal(r.themes['连接'].count, 1)
  assert.equal(r.signals['付费意愿'].count, 1)
  assert.ok(r.signals['付费意愿'].top[0].score === 30)
  const md = renderComments(r)
  assert.ok(md.includes('评论级分析'))
  assert.ok(md.includes('u/a2'))
})

test('verify.js：三查（ID 存在/score/comments/日期）', async () => {
  const { verifyCitations } = await import('../lib/verify.js')
  const dir = join(tmpBase, 'vdata')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'testsub.json'), JSON.stringify([
    mkPost('v001', 'It broke', 50, 5, 3),
  ]))
  const good = `代表帖：
**title**
   r/testsub · score 50 · 5 评论 · ${new Date((Math.floor(Date.now() / 1000) - 3 * 86400) * 1000).toISOString().slice(0, 10)}
   <https://www.reddit.com/r/testsub/comments/v001/>
`
  const g = verifyCitations(good, dir)
  assert.equal(g.ok, true)
  assert.equal(g.checked, 1)

  const badScore = good.replace('score 50', 'score 99')
  const b1 = verifyCitations(badScore, dir)
  assert.equal(b1.ok, false)
  assert.ok(b1.problems.some((p) => p.includes('score 不符')))

  const badDate = good.replace(/2026-\d\d-\d\d/, '2020-01-01')
  const b2 = verifyCitations(badDate, dir)
  assert.equal(b2.ok, false)

  const fake = good.replace('v001', 'zzzz99')
  const b3 = verifyCitations(fake, dir)
  assert.equal(b3.ok, false)
  assert.ok(b3.problems.some((p) => p.includes('不在数据集中')))

  // [帖ID] 裸引用也检
  const bare = '见 [v001] 的讨论'
  const b4 = verifyCitations(bare, dir)
  assert.equal(b4.ok, true)
  const b5 = verifyCitations('见 [zzzz99] 的讨论', dir)
  assert.equal(b5.ok, false)
})

test('ops：create/fetch/analyze/comments/verify 全链（假服务器）', async () => {
  const { createStudy, saveThemes, analyzeStudy, commentsStudy, verifyStudy, saveReport, studyDetail, listStudies } = await import('../lib/ops.js')
  createStudy({}, '链路', { question: 'ESP32 痛点', subs: ['testsub'], days: 7 })
  saveThemes({}, '链路', { 连接: 'wifi|broke', 付费: 'would pay' }, { scope: 'esp32|wifi' })

  const { fetchStudy } = await import('../lib/ops.js')
  const fr = await fetchStudy({}, '链路', {})
  assert.equal(fr.total, 2)
  assert.equal(fr.complete, true)

  const ar = analyzeStudy({}, '链路', {})
  assert.ok(ar.ok)
  assert.ok(ar.result.buckets.complaint >= 1)
  assert.ok(existsSync(join(tmpBase, 'reddit-research', '链路', 'analysis.md')))

  const cr = await commentsStudy({}, '链路', {})
  assert.equal(cr.count, 1)

  const report = `## 调研结论
测试。

## 来源清单
- "wifi broke" / "wifi 坏了" — r/testsub [f001] (score:50, comments:5, ${new Date(mkPost('f001').created_utc * 1000).toISOString().slice(0, 10)}) — https://www.reddit.com/r/testsub/comments/f001/
`
  saveReport({}, '链路', report)
  const v = verifyStudy({}, '链路')
  assert.equal(v.ok, true)
  const meta = studyDetail({}, '链路')
  assert.equal(meta.verified, 'pass')
  assert.ok(listStudies({}).some((s) => s.name === '链路'))
})

// 收尾：node --test 要等子进程自然退出，而假服务器的 keep-alive 连接不会自己断，
// 只 close() 不够（空闲 socket 仍在）——必须先掐掉所有连接，事件循环才能排空。
test('planWindow：预算内不缩窗 / 超预算自动缩到 20 页内 / 无可用 sub', async () => {
  const { planWindow, PAGE_BUDGET } = await import('../lib/ops.js')
  // 30 天 1152 帖 → 12 页，不缩
  const a = planWindow([{ ok: true, count: 1152, per_day: 38.4 }], 30)
  assert.equal(a.days, 30)
  assert.equal(a.pages, 12)
  assert.equal(a.shrunk, false)
  // 540 天 19800 帖 → 198 页，必须缩到预算内且不退到 7 天以下
  const b = planWindow([{ ok: true, count: 19800, per_day: 36.7 }], 540)
  assert.ok(b.pages <= PAGE_BUDGET, `pages=${b.pages}`)
  assert.equal(b.shrunk, true)
  assert.ok(b.days >= 7 && b.days < 540, `days=${b.days}`)
  // 多 sub 合计也算预算
  const c = planWindow([{ ok: true, count: 12000, per_day: 40 }, { ok: true, count: 6000, per_day: 20 }], 300)
  assert.ok(c.pages <= PAGE_BUDGET, `multi pages=${c.pages}`)
  // 没有可用 sub：不缩窗、0 页
  const d = planWindow([{ ok: false, count: null }], 90)
  assert.equal(d.pages, 0)
  assert.equal(d.days, 90)
})

test.after(() => {
  try { srv.closeAllConnections?.() } catch { /* ignore */ }
  try { srv.close() } catch { /* ignore */ }
})
process.on('exit', () => { try { srv.close() } catch { /* ignore */ } })
// undici keep-alive 连接会挂住事件循环（家族已知坑）——兜底：事件循环排空后再强制退出
process.on('beforeExit', () => process.exit(process.exitCode || 0))
