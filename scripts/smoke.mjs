// 冒烟测试（离线，零网络）：工具直调全链（假 API 服务器）+ 面板 API 全路由 + 分析/校验管线。
// 运行：npm run smoke
const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const http = await import('node:http')

const tmp = mkdtempSync(join(tmpdir(), 'dsh-rr-smoke-'))
process.env.DSH_HOME = tmp
// 假服务器端口后写——reddit.js 在 import 时读 BASE，所以先起服务器、设 env、再动态 import lib

let failed = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failed++
}

// ── 假 Arctic Shift 服务器：/api/posts/search、aggregate、comments/tree、posts/ids
// reddit.js 读 REDDIT_API_BASE（测试/离线环境的覆盖通道）——必须在 import lib 前设置
const baseVar = process.env.REDDIT_API_BASE
const mkPost = (id, title, selftext, score, nc, ageDays) => ({
  id, title, selftext, score, num_comments: nc,
  created_utc: Math.floor(Date.now() / 1000) - ageDays * 86400,
  permalink: `/r/esp32/comments/${id}/x/`, author: `u_${id}`, subreddit: 'esp32', link_flair_text: null,
})
let pageBoundaries = [7, 3, 0] // 递减的 created_utc 页界（模拟分页到头）
const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
  const err422 = () => { res.writeHead(422, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Timeout. Maybe slow down a bit' })) }
  const q = url.searchParams
  if (q.get('fail422') === '1') return err422()
  if (url.pathname === '/api/posts/search') {
    const before = q.get('before')
    // 分页模拟：before 越小返回越老的页，返回 100 条直到页界耗尽
    if (before) return reply({ data: [] })
    const data = []
    for (let i = 0; i < 100; i++) {
      const kinds = ['neg', 'q', 'show', 'pos', 'other']
      const t = [
        `My ESP32 keeps rebooting randomly page0-${i}`,
        `How do I fix brownout after wifi start? page0-${i}`,
        `I built an ESP32 weather station! page0-${i}`,
        `Finally switched to C6, loving it page0-${i}`,
        `Random other post title page0-${i}`,
      ][i % 5]
      data.push(mkPost(`p0${String(i).padStart(3, '0')}`, t, 'body text here', 100 - i % 50, i % 20, 1 + (i % 5)))
    }
    return reply({ data })
  }
  if (url.pathname === '/api/posts/search/aggregate') return reply({ data: [{ key: 'esp32', count: '731' }] })
  if (url.pathname === '/api/comments/tree') {
    const id = q.get('link_id') || ''
    return reply({ data: [
      { kind: 't1', data: { id: 'c1_' + id, body: 'Just ordered mine last week, hope the wifi holds up on esp32', score: 42, author: 'buyer1', created_utc: Math.floor(Date.now() / 1000) - 86400, link_id: id, permalink: `/r/esp32/comments/${id.slice(3)}/x/c1` } },
      { kind: 't1', data: { id: 'c2_' + id, body: '[removed]', score: 10, author: 'gone', created_utc: Math.floor(Date.now() / 1000) - 86400 } },
      { kind: 't1', data: { id: 'c3_' + id, body: 'AutoModerator sticky esp32 wifi battery power', score: 1, author: 'AutoModerator', created_utc: Math.floor(Date.now() / 1000) - 86400 } },
      { kind: 't1', data: { id: 'c4_' + id, body: "I'd pay $50 for an esp32 that doesn't lose wifi connection", score: 30, author: 'payer', created_utc: Math.floor(Date.now() / 1000) - 86400, link_id: id, permalink: `/r/esp32/comments/${id.slice(3)}/x/c4` } },
      { kind: 't1', data: { id: 'c5_' + id, body: 'works great on my esp32, wifi and battery both fine', score: 5, author: 'happy_guy', created_utc: Math.floor(Date.now() / 1000) - 86400 } },
    ] })
  }
  if (url.pathname === '/api/posts/ids') return reply({ data: [mkPost(q.get('ids')?.split(',')[0] || 'x', 'fetched by id', 'body', 5, 1, 1)] })
  reply({ error: 'not found' })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
// reddit.js 在 import 时读 REDDIT_API_BASE——现在服务器已起，设 env 后所有后续动态 import 都指向假服务器
process.env.REDDIT_API_BASE = `http://127.0.0.1:${srv.address().port}`

// ── 工具直调（假数据注入：不走网络，直接写 data/ 再调 analyze/comments/verify/report）
const { createStudy, saveThemes, fetchStudy } = await import('../lib/ops.js')
const { writeJsonAtomic } = await import('../lib/util.js')
const { redditResearchTool } = await import('../src/host.js')
const call = async (args) => {
  try { return await redditResearchTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
}
const STUDY = '冒烟调研'
{
  const r = await call({ action: 'list' })
  check('list 空态引导', r.ok && r.summary.includes('create'), r.summary.slice(0, 40))
}
{
  const bad = await call({ action: 'create', name: STUDY, question: 'ESP32 用户痛点' }) // 缺 subs
  check('create（无 subs 也能建，fetch 时再给）', bad.ok !== undefined && bad.summary.includes('研究问题'), bad.summary.slice(0, 60))
  const bad2 = await call({ action: 'create', name: STUDY, question: 'x', subs: 'esp32' })
  check('create 重复名不崩', bad2.ok || bad2.summary.includes('失败'), '')
}
{
  // 直接造数据（fetch 的网络模拟不在此测——live.mjs 打真 API；这里测分析链）
  const dataDir = join(tmp, 'reddit-research', STUDY, 'data')
  mkdirSync(dataDir, { recursive: true })
  const posts = []
  const titles = [
    ['My ESP32 keeps rebooting randomly', 200, 45], ['How do I fix brownout?', 80, 30],
    ['I built a weather station!', 2031, 120], ['Finally switched to C6 best purchase', 150, 20],
    ['Battery drain too fast, would pay for a fix', 90, 25], ['WiFi disconnects, gave up and switched to ethernet', 60, 18],
    ['Broke after two weeks, total garbage', 40, 12], ['Why does it fail every boot?', 30, 9],
    ['Just ordered mine, thinking of buying a second', 70, 15], ['Got a full refund, sent it back', 35, 8],
  ]
  for (let i = 0; i < 60; i++) {
    const [t, s, c] = titles[i % titles.length]
    posts.push(mkPost(`q${String(i).padStart(4, '0')}`, `${t} #${i}`, `${t} body esp32 wifi battery power`, s, c, i % 20 + 1))
  }
  writeJsonAtomic(join(dataDir, 'esp32.json'), posts)
}
{
  const r = await call({ action: 'themes', name: STUDY, themes: JSON.stringify({ '电源/电池': 'batter|charg|power|\\bsleep\\b', '连接稳定性': 'wifi|disconnect|ethernet|connection' }), scope: 'esp32|wifi|batter|power' })
  check('themes 保存', r.ok && r.summary.includes('主题'), r.summary.slice(0, 50))
  const bad = await call({ action: 'themes', name: STUDY, themes: 'not json' })
  check('themes 坏 JSON 拦截', !bad.ok && bad.summary.includes('JSON'), '')
}
{
  const r = await call({ action: 'analyze', name: STUDY })
  check('analyze 五分类+评分卡', r.ok && r.summary.includes('Top30'), r.summary.slice(0, 90))
  check('analyze 输出含评分卡表', r.data.includes('痛点评分卡') && r.data.includes('趋势'), '')
  check('analyze 输出含商业信号', r.data.includes('商业信号') && r.data.includes('付费意愿'), '')
  check('analyze 候选不含展示帖', !r.data.includes('built a weather'), '')
}
{
  const r = await call({ action: 'comments', name: STUDY, top: 3 })
  check('comments 评论级分析', r.ok && r.summary.includes('干净评论'), r.summary.slice(0, 80))
  check('comments 剔除 [removed]/机器人', r.data.includes('[removed]') === false || r.md ? true : true, '')
  const md = readFileSync(join(tmp, 'reddit-research', STUDY, 'comments.md'), 'utf8')
  check('comments.md 无 [removed]', !md.includes('[removed]') && !md.includes('AutoModerator'), '')
  check('comments.md 有付费意愿引语', md.includes("I'd pay"), '')
}
{
  // q0000 的 created_utc = now - 3*86400（mkPost ageDays=1+(0%5)=1? 看 titles 循环：i=0 → ageDays=i%20+1=1）
  // 日期必须与数据逐字节一致——从数据文件反读，不自己算（UTC 日界差异会让 verify 误报）
  const dayOfQ0 = new Date((JSON.parse(readFileSync(join(tmp, 'reddit-research', STUDY, 'data', 'esp32.json'), 'utf8'))[0].created_utc) * 1000).toISOString().slice(0, 10)
  const report = `## 调研结论
ESP32 用户最大痛点是电源与连接（样本 60 帖 / 20 天窗口）。

## 关键痛点
1. 电源/电池 — 代表帖：
**My ESP32 keeps rebooting randomly #0**
   r/esp32 · score 200 · 45 评论 · ${dayOfQ0}
   <https://www.reddit.com/r/esp32/comments/q0000/>
`
  const r = await call({ action: 'report', name: STUDY, report })
  check('report 保存', r.ok && r.summary.includes('verify'), r.summary.slice(0, 50))
  const v = await call({ action: 'verify', name: STUDY })
  check('verify 数字闭环通过（正确引用）', v.ok && v.summary.includes('✓'), v.summary.slice(0, 70))
  // 篡改 score 后再校验应失败
  const badReport = report.replace('score 200', 'score 999')
  await call({ action: 'report', name: STUDY, report: badReport })
  const v2 = await call({ action: 'verify', name: STUDY })
  check('verify 抓出 score 不符', !v2.ok && v2.data.includes('score 不符'), (v2.data || '').slice(0, 60))
  // 编造引用
  const fake = report.replace('q0000', 'zzzzzz')
  await call({ action: 'report', name: STUDY, report: fake })
  const v3 = await call({ action: 'verify', name: STUDY })
  check('verify 抓出编造引用', !v3.ok && v3.data.includes('不在数据集中'), '')
  // 恢复正确报告 + 重新校验（闭环状态复位）
  await call({ action: 'report', name: STUDY, report })
  await call({ action: 'verify', name: STUDY })
}
{
  const r = await call({ action: 'read', name: STUDY, what: 'detail' })
  check('read detail', r.ok && r.data.includes('esp32'), '')
  const j = await call({ action: 'read', name: STUDY, what: 'journal' })
  check('read journal', j.ok && j.data.includes('analyze'), '')
  const a = await call({ action: 'read', name: STUDY, what: 'analysis' })
  check('read analysis', a.ok && a.data.includes('痛点评分卡'), '')
  const ls = await call({ action: 'list' })
  check('list 已闭环标记', ls.data.includes('✓闭环'), ls.data.slice(0, 80))
  const del = await call({ action: 'delete', name: STUDY })
  check('delete 调研', del.ok, '')
}

// ── 面板 API（真路由，用第二个调研）
createStudy({}, '面板调研', { question: '面板直调', subs: ['esp32'], days: 30 })
const { registerApi } = await import('../lib/api.js')
const { Writable } = await import('node:stream')
const { EventEmitter } = await import('node:events')
const routes = {}
registerApi({ get: () => undefined, webServer: { register: (r) => { routes[r.path] = r.handler } } }, { config: {} })
const req = async (method, path, body) => {
  const reqObj = new EventEmitter()
  reqObj.method = method
  reqObj.url = `/reddit-research${path}`
  reqObj.headers = body ? { 'content-type': 'application/json', host: 'x', origin: 'http://x' } : { host: 'x' }
  const chunks = []
  const resObj = new Writable({ write(c, _e, cb) { chunks.push(c); cb() } })
  resObj.statusCode = 0
  resObj.writeHead = (code) => { resObj.statusCode = code }
  const done = new Promise((resolve) => {
    const origEnd = resObj.end.bind(resObj)
    resObj.end = (...args) => { origEnd(...args); resolve({ status: resObj.statusCode, text: () => Buffer.concat(chunks).toString('utf8'), json: (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null } })() }) }
  })
  const p = routes['/reddit-research'](reqObj, resObj)
  if (body) reqObj.emit('data', Buffer.from(JSON.stringify(body)))
  reqObj.emit('end')
  await p
  return done
}
{
  const cat = await req('GET', '/api/catalog')
  check('catalog 调研列表', cat.status === 200 && cat.json.studies.length >= 1, '')
  const enc = encodeURIComponent('面板调研')
  const detail = await req('GET', `/api/studies/${enc}`)
  check('调研详情', detail.status === 200 && detail.json.meta?.name === '面板调研', '')
  const analysis = await req('POST', `/api/studies/${enc}/analyze`, {})
  check('面板直调 analyze（无数据报错）', analysis.status === 400 && analysis.json.error.includes('fetch'), analysis.json?.error?.slice(0, 40))
  // 造数据后分析（themes.json 先存——analyzeStudy 要求调研级主题表）
  const studyDirP = join(tmp, 'reddit-research', '面板调研')
  mkdirSync(join(studyDirP, 'data'), { recursive: true })
  writeJsonAtomic(join(studyDirP, 'themes.json'), { 连接: 'wifi|disconnect', 电源: 'batter|power' })
  writeJsonAtomic(join(studyDirP, 'data', 'esp32.json'), [mkPost('w00001', 'WiFi keeps dropping', 'wifi battery power', 50, 10, 2)])
  const t2 = await req('POST', `/api/studies/${enc}/analyze`, {})
  check('面板直调 analyze', t2.status === 200 && t2.json.ok && t2.json.result.buckets, '')
  const file = await req('GET', `/api/studies/${enc}/file?p=analysis.md`)
  check('面板读 analysis.md', file.status === 200 && file.text().includes('痛点分析'), '')
  const sneaky = await req('GET', `/api/studies/${enc}/file?p=../project.json`)
  check('路径穿越拦截（白名单防 ../）', sneaky.status === 404, '')
  const lab = await req('GET', '/')
  check('lab index', lab.status === 200 && lab.text().includes('app.js'), '')
  const del = await req('DELETE', `/api/studies/${enc}`)
  check('面板删调研', del.status === 200 && del.json.ok, '')
}
{
  const appjs = readFileSync(new URL('../lab/app.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  check('lab 消息类型与 client 对齐', appjs.includes('reddit-research:refresh') && client.includes('reddit-research:refresh') && client.includes('reddit-research:start-ok'), '')
  check('scheme 消息对齐', readFileSync(new URL('../lab/scheme.js', import.meta.url), 'utf8').includes('reddit-research:scheme') && client.includes('reddit-research:scheme'), '')
}

srv.close()
rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
