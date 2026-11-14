// Reddit 调研台 · 面板逻辑：调研库 → 调研详情（数据构成/五分类/评分卡/商业信号/报告+闭环状态）。
// 抓取与分析重活在对话里让 agent 跑（fetch 可能几分钟）；面板提供探活/拉取/分析/校验直调与全部只读视图。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  // 近似重复判据（与 lib/feed.js 同口径）：同作者 + 归一化标题相同。
  // 面板按页累加，分页边界与刷量帖会在相邻两页各出现一次，必须在这里再折一次。
  const normTitle = (t) => String(t || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\bi\s*(?:will|won'?t)\s*not\s*promote\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  const dupKey = (p) => `${String(p.author || '').toLowerCase()}|${normTitle(p.title)}`
  const BURST_SECONDS = 6 * 3600
  const burstKey = (p) => `${String(p.author || '').toLowerCase()}|${Math.floor((Number(p.created_utc) || 0) / BURST_SECONDS)}`

  // ── 报告渲染：轻量 Markdown → HTML（零依赖；先 esc 再套标签，链接只放行 http(s)/站内）
  const MD_BLOCK = /^\s*(#{1,6}\s|```|>\s?|\||[-*+]\s|\d+[.)]\s|([-*_])\s*(\2\s*){2,}$)/
  function mdInline(src) {
    let t = esc(src)
    const codes = []
    t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
    t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2" loading="lazy">')
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|#[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    t = t.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    t = t.replace(/__([^_]+)__/g, '<b>$1</b>')
    t = t.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    t = t.replace(/(^|[^\w])_([^_\n]+)_/g, '$1<i>$2</i>')
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`)
  }
  function mdToHtml(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
    const out = []
    let i = 0
    const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l || '')
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) { i++; continue }
      if (/^\s*```/.test(line)) { // 代码块
        const buf = []
        i++
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
        i++
        out.push(`<pre class="md-pre"><code>${esc(buf.join('\n'))}</code></pre>`)
        continue
      }
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { out.push('<hr>'); i++; continue }
      const hm = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
      if (hm) { out.push(`<h${Math.min(hm[1].length, 4)}>${mdInline(hm[2])}</h${Math.min(hm[1].length, 4)}>`); i++; continue }
      if (line.includes('|') && isSep(lines[i + 1] || '')) { // GFM 表格
        const head = cells(line)
        const aligns = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''))
        i += 2
        const body = []
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(cells(lines[i++]))
        const al = (k) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : '')
        out.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${head.map((h, k) => `<th${al(k)}>${mdInline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${head.map((_, k) => `<td${al(k)}>${mdInline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
        continue
      }
      if (/^\s*>/.test(line)) { // 引用
        const buf = []
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
        out.push(`<blockquote>${mdInline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`)
        continue
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) { // 列表
        const ordered = /^\s*\d/.test(line)
        const items = []
        while (i < lines.length) {
          const m2 = lines[i].match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
          if (!m2) break
          items.push(m2[1]); i++
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${mdInline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`)
        continue
      }
      const buf = []
      while (i < lines.length && lines[i].trim() && !MD_BLOCK.test(lines[i])) buf.push(lines[i++])
      if (!buf.length) buf.push(lines[i++])
      out.push(`<p>${mdInline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`)
    }
    return out.join('\n')
  }
  const weight = (p) => (Number(p.score) || 0) + 3 * (Number(p.num_comments) || 0)

  let toastTimer
  function toast(msg, isErr = false) {
    $toast.textContent = msg
    $toast.className = 'toast' + (isErr ? ' err' : '')
    $toast.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { $toast.hidden = true }, isErr ? 5200 : 2800)
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/reddit-research${path}`, opts)
    const ct = res.headers.get('content-type') || ''
    const body = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text()
    if (!res.ok) {
      const err = new Error((body && body.error) || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return body
  }
  const apiPost = (path, payload) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) })

  // ── 送给 agent 对话（其他插件同款：postMessage 让宿主开新对话填草稿 → start-ok 握手 → 独立预览时退回剪贴板）
  let EMBEDDED = false
  try { EMBEDDED = parent !== window } catch { EMBEDDED = false }

  function copyText(text) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        toast('草稿已复制——粘贴到 dsh 对话即可开始')
      } catch { toast('复制失败，请手动选中指令', true) }
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('草稿已复制——粘贴到 dsh 对话即可开始'), fallback)
    else fallback()
  }

  function sendAgentPrompt(prompt, okMsg = '已在宿主开新对话——agent 接着处理') {
    if (!EMBEDDED) return copyText(prompt)
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; removeEventListener('message', onMsg); copyText(prompt) } }, 1500)
    function onMsg(e) {
      if (e.origin !== location.origin || done) return
      if (e.data?.type === 'reddit-research:start-ok') { done = true; clearTimeout(timer); removeEventListener('message', onMsg); toast(okMsg) }
      else if (e.data?.type === 'reddit-research:start-failed') { done = true; clearTimeout(timer); removeEventListener('message', onMsg); toast(`没能开新对话：${e.data.message || ''}`, true) }
    }
    addEventListener('message', onMsg)
    try { parent.postMessage({ type: 'reddit-research:refresh', prompt }, location.origin) } catch { done = true; clearTimeout(timer); removeEventListener('message', onMsg); copyText(prompt) }
  }

  function startPrompt({ name, question, subs, days }) {
    const subList = String(subs || '').split(/[,，\s]+/).map((s) => s.trim().replace(/^r\//i, '')).filter(Boolean)
    return [
      '新建并开始一个 Reddit 调研：',
      `- 调研名：${name}`,
      `- 研究问题：${question}`,
      `- subreddit：${subList.length ? subList.map((s) => 'r/' + s).join(', ') : '（待定）'}`,
      `- 时间窗：${days} 天`,
      '',
      `请先 reddit_research(action="create", name="${name}", question="${question}"${subList.length ? `, subs="${subList.join(',')}"` : ''}, days=${days})，`,
      '再 action="probe"：窗口由 probe 按页数预算（单次 ≤20 页）自动定，写回调研后直接 action="fetch"——**不要回头问我确认窗口**，你自己按数据判断即可。',
      '纪律：每条结论附原帖链接、只写相关帖、数据不足写「需补调研：X」禁止凑数、报告写完必须 verify 数字闭环。',
    ].join('\n')
  }

  // ── 路由
  const routes = []
  const route = (re, fn) => routes.push([re, fn])
  function navigate() {
    const hash = location.hash || '#/'
    window.scrollTo(0, 0)
    for (const [re, fn] of routes) {
      const m = hash.match(re)
      if (m) return fn(...m.slice(1))
    }
    $app.innerHTML = '<div class="empty">404</div>'
  }
  addEventListener('hashchange', navigate)

  const busyBtn = (btn, label) => {
    if (!btn) return () => {}
    const old = btn.textContent
    btn.disabled = true
    btn.innerHTML = `<span class="spin"></span> ${label}`
    return () => { btn.disabled = false; btn.textContent = old }
  }

  // ── 发起调研（填一行 → 开新对话把指令带过去）
  route(/^#\/new$/, renderNew)
  function renderNew() {
    $app.innerHTML = `
      <a href="#/" class="muted" style="font-size:12px">← 调研库</a>
      <h1>发起调研</h1>
      <p class="lead">先把研究问题钉死一行：<b>品类/产品 + 要回答的决策问题 + 目标用户</b>。没有它，后面所有筛选都没有准绳。点「发起调研」会开一个新对话并填好指令（不自动发送），agent 接着跑探活 → 拉取 → 主题表 → 分析。</p>
      <div class="card" style="max-width:760px">
        <label for="f-name">调研名</label>
        <input type="text" id="f-name" placeholder="如 假发品类调研" autocomplete="off">
        <label for="f-question">研究问题（一行钉死）</label>
        <textarea id="f-question" placeholder="如 美国 25-40 岁黑人女性假发：值不值得做、主要在抱怨什么、愿意为哪些点付钱"></textarea>
        <div class="row">
          <div><label for="f-subs">subreddit（逗号分隔，不带 r/）</label><input type="text" id="f-subs" placeholder="Wigs,HaircareScience" autocomplete="off"></div>
          <div style="max-width:140px"><label for="f-days">时间窗（天）</label><input type="number" id="f-days" value="90" min="1" max="2000"></div>
        </div>
        <div class="row" style="margin-top:16px">
          <button id="f-go" style="flex:0 0 auto">＋ 发起调研</button>
          <span class="muted" style="font-size:12px;align-self:center">agent 自己 probe 定窗（单次 ≤20 页，超了按日均自动缩窗），不用你确认；每 100 帖 1 页 ≈ 0.75 秒。</span>
        </div>
      </div>
      <h2>三种常见问法</h2>
      <div class="card" style="font-size:13px;line-height:2">
        · 「r/xxx 最近在抱怨什么」——轻量流程：probe → fetch → themes → analyze，出痛点清单<br>
        · 「某品类值不值得做」——深度流程：另读 references/deep_research_10_modules.md，出 B1–B7 商业决策报告<br>
        · 「r/xxx 的用户怎么看这个品牌」——scope 正则 + KOC 软文检测 + 评论级口碑矩阵
      </div>
    `
    document.getElementById('f-go').addEventListener('click', () => {
      const name = document.getElementById('f-name').value.trim()
      const question = document.getElementById('f-question').value.trim()
      const subs = document.getElementById('f-subs').value.trim()
      const days = Math.max(1, Math.min(2000, Number(document.getElementById('f-days').value) || 90))
      if (!name) return toast('先填调研名', true)
      if (!question) return toast('先填研究问题——没有它，后面所有筛选没有准绳', true)
      sendAgentPrompt(startPrompt({ name, question, subs, days }))
    })
    document.getElementById('f-name').focus()
  }

  // ── 海外动态：16 个精选社区目录 + 最新帖流（分页 before 游标，刷新看更多）
  route(/^#\/feed$/, renderFeed)
  async function renderFeed() {
    let cat
    try { cat = await api('/api/feed/catalog') } catch (e) { $app.innerHTML = `<div class="empty">面板服务连接失败：${esc(e.message)}</div>`; return }
    const state = { group: '全部' }
    const rv = document.getElementById('rail-version')
    if (rv && cat.version) rv.textContent = 'v' + cat.version
    render()

    function render() {
      const subs = cat.subs.filter((s) => state.group === '全部' || s.group === state.group)
      const chips = ['全部', ...cat.groups].map((g) =>
        `<span class="chip ${state.group === g ? 'on' : ''}" data-group="${esc(g)}">${esc(g)}</span>`).join('')
      const cards = subs.map((s) => `
        <div class="card sub-card">
          <div class="head">
            <a class="rname" href="#/feed/${encodeURIComponent(s.sub)}">r/${esc(s.sub)}</a>
            <span class="visits">月访问 ${esc(s.visits)}</span>
          </div>
          <div class="muted" style="font-size:12.5px">${esc(s.desc)}</div>
          <div class="row"><a class="btn small" href="#/feed/${encodeURIComponent(s.sub)}">最新帖 →</a></div>
        </div>`).join('')
      $app.innerHTML = `
        <h1>海外动态</h1>
        <p class="lead">${esc(cat.note)}。点进社区看最新帖，「加载更多」按 before 游标续拉。</p>
        <div class="chips">${chips}</div>
        <div class="sub-grid">${cards}</div>`
      $app.querySelectorAll('[data-group]').forEach((chip) => {
        chip.addEventListener('click', () => { state.group = chip.dataset.group; render() })
      })
    }
  }

  route(/^#\/feed\/(.+)$/, (sub0) => renderFeedSub(decodeURIComponent(sub0)))
  async function renderFeedSub(sub) {
    $app.innerHTML = `
      <a href="#/feed" class="muted" style="font-size:12px">← 海外动态</a>
      <div class="feed-sub-head">
        <h1 style="flex:1;margin:0">r/${esc(sub)}</h1>
        <button id="btn-deep" class="small" disabled title="把已加载的帖子清单发给 agent 深度分析">🔍 深度分析</button>
      </div>
      <p class="lead">最新帖（Arctic Shift 档案，滞后约 36h；数据只读，不含发帖自动化）。「深度分析」会把当前已加载的帖子清单直接带进新对话，无需重抓。</p>
      <div id="feed-box" class="card"><span class="spin"></span> 拉取中…</div>
      <div class="loadmore"><button id="btn-more" class="ghost" disabled>加载更多</button></div>
      <div id="feed-note" class="muted" style="font-size:12px"></div>
    `
    let nextBefore = null
    let loaded = 0
    let collapsed = 0
    const allPosts = []
    const seenKeys = new Set()
    const seenBurst = new Set()
    const load = async (before) => {
      const box = document.getElementById('feed-box')
      const btn = document.getElementById('btn-more')
      try {
        const r = await api(`/api/feed?sub=${encodeURIComponent(sub)}${before ? `&before=${before}` : ''}&limit=100`)
        const list = r.posts || []
        // 跨页去重：同作者+同归一化标题只留第一页出现的那条
        const fresh = []
        for (const p of list) {
          const key = dupKey(p)
          const bkey = burstKey(p)
          if (seenKeys.has(key) || seenBurst.has(bkey)) { collapsed++; continue }
          seenKeys.add(key)
          seenBurst.add(bkey)
          fresh.push(p)
        }
        loaded += fresh.length
        collapsed += Number(r.collapsed) || 0
        allPosts.push(...fresh)
        nextBefore = r.nextBefore
        const rows = fresh.map((p) => {
          const d = new Date((p.created_utc || 0) * 1000)
          const link = p.permalink ? `https://www.reddit.com${p.permalink}` : '#'
          const flair = p.link_flair_text ? `<span class="flair">${esc(p.link_flair_text)}</span>` : ''
          return `<div class="post-row">
            <div class="post-score">${p.score ?? '–'}<small>👍</small></div>
            <div class="post-main">
              <div class="post-title"><a href="${esc(link)}" target="_blank" rel="noreferrer">${esc(p.title || '(无标题)')}</a>${flair}</div>
              <div class="post-meta">r/${esc(p.subreddit || sub)} · u/${esc(p.author || '-')} · ${esc(d.toISOString().slice(0, 10))} · 💬 ${p.num_comments ?? 0} 评论 · <a href="${esc(link)}" target="_blank" rel="noreferrer">原帖 ↗</a></div>
            </div>
          </div>`
        }).join('')
        box.innerHTML = (box.dataset.body || '') + (rows || '<div class="empty">没有更多帖了</div>')
        box.dataset.body = (box.dataset.body || '') + (rows || '')
        document.getElementById('feed-note').textContent = `已加载 ${loaded} 帖${collapsed ? `（折叠 ${collapsed} 条重复/已删帖）` : ''}`
        btn.disabled = !nextBefore
        btn.textContent = nextBefore ? '加载更多' : '到底了'
        btn.onclick = nextBefore ? () => load(nextBefore) : null
      } catch (e) {
        box.innerHTML = `<div class="empty">拉取失败：${esc(e.message)}（Arctic Shift 过载常见，点重试）</div>`
        btn.disabled = false
        btn.textContent = '重试'
        btn.onclick = () => load(before)
      }
    }
    document.getElementById('btn-more').addEventListener('click', () => load(nextBefore))
    // 深度分析：把已加载的帖子清单发给 agent（数据已在消息里，无需重抓）
    document.getElementById('btn-deep').addEventListener('click', () => {
      if (!allPosts.length) return toast('还没有帖子——先拉取', true)
      const MAX = 500
      const rows = allPosts.slice(0, MAX).map((p) => {
        const d = new Date((p.created_utc || 0) * 1000).toISOString().slice(0, 10)
        return `[${p.score ?? '-'}赞|${p.num_comments ?? 0}评|${d}] ${(p.title || '').replace(/\n/g, ' ')} — https://www.reddit.com${p.permalink || ''}`
      })
      const trimmed = allPosts.length > MAX ? `\n（帖子超过 ${MAX} 条，只带前 ${MAX} 条——按 score+comments 保留高互动的）` : ''
      if (allPosts.length > MAX) rows.sort((a, b) => 0) // 保序：feed 本身按时间倒序
      const prompt = [
        `以下是 Reddit r/${sub} 最新 ${Math.min(allPosts.length, MAX)} 帖（Arctic Shift 档案快照，数据已在本消息里，不要重新抓取）。请做一次深度分析：`,
        '',
        '1. 标题级快速五分类（抱怨/求助/展示/称赞/其他）——判据放标题级，展示帖只进生态统计不进痛点',
        '2. 痛点主题归纳与评分（普遍度×严重度×趋势），Top 主题给代表帖链接；引用前读语义（"finally cracked it" 是正面）',
        '3. 商业信号扫描：购买意图 / 付费意愿 / 弃用流失 / 退货退款，各给代表引语',
        '4. 按「调研结论 / 关键痛点 / 矛盾与不确定 / 来源清单」格式输出，每条结论附原帖链接',
        '5. 数据不足以支撑的结论写「需补调研：X」，禁止凑数编造；若样本值得深挖，建议我用 reddit_research(action=create → probe → fetch) 建正式调研',
        '',
        `样本口径：r/${sub} · ${Math.min(allPosts.length, MAX)} 帖 · 数据行格式 [score|评论数|日期] 标题 — 链接${trimmed}`,
        '',
        rows.join('\n'),
      ].join('\n')
      sendAgentPrompt(prompt, `已把 ${Math.min(allPosts.length, MAX)} 帖带进新对话，agent 开始深度分析`)
    })
    load(null).then(() => {
      if (loaded > 0) document.getElementById('btn-deep').disabled = false
    })
  }

  // ── 调研库
  route(/^#\/$/, renderHome)
  async function renderHome() {
    let catalog
    try { catalog = await api('/api/catalog') } catch (e) { $app.innerHTML = `<div class="empty">面板服务连接失败：${esc(e.message)}</div>`; return }
    document.getElementById('rail-version').textContent = 'v' + (catalog.version || '0.1.0')

    const listHtml = catalog.studies.length
      ? `<div class="grid cols2">` + catalog.studies.map((s) => `
        <div class="card study-card">
          <div class="head">
            <span class="title">${esc(s.name)}</span>
            ${s.has_report ? (s.verified === 'pass' ? '<span class="tag ok">✓ 闭环</span>' : s.verified === 'fail' ? '<span class="tag fail">✗ 未闭环</span>' : '<span class="tag gray">报告未校验</span>') : s.has_analysis ? '<span class="tag">已分析</span>' : '<span class="tag gray">采集中</span>'}
          </div>
          <div class="muted" style="font-size:12px">${esc(s.question || '')}</div>
          <div class="stats">
            <span><b>${s.subs.map((x) => 'r/' + esc(x)).join('</b>, <b>')}</b></span>
            <span><b>${s.days}</b> 天窗</span>
            <span>数据 <b>${s.with_data}/${s.subs.length}</b> sub</span>
            ${s.has_comments ? '<span>已补刀</span>' : ''}
          </div>
          <div class="row">
            <a class="btn small" href="#/s/${encodeURIComponent(s.name)}">打开</a>
            <button class="danger small" data-del="${esc(s.name)}">删除</button>
          </div>
        </div>`).join('') + '</div>'
      : `<div class="empty"><div>还没有调研——钉死研究问题后发起一次。</div><p style="margin:8px 0 0">agent 会按 probe → fetch → themes → analyze → comments → report → verify 走完，全部结论带原帖链接。</p><a class="btn" href="#/new" style="margin-top:16px;display:inline-block">＋ 发起第一个调研</a></div>`

    $app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Reddit 调研台</h1>
          <p class="lead" style="margin:0">Arctic Shift 免认证档案 API（数据滞后约 36h）。流程：探活估样本量 → 全量拉取（断点续传）→ 主题表 → 帖级分析（五分类+评分卡）→ 评论树补刀 → 报告 + 数字闭环校验。全部结论带原帖链接可复算。</p>
        </div>
        <a class="btn" href="#/new">＋ 发起调研</a>
      </div>
      <h2>调研库${catalog.studies.length ? `<span class="muted" style="font-weight:400;font-size:12px"> · ${catalog.studies.length} 个</span>` : ''}</h2>
      ${listHtml}
      <p class="lead" style="margin-top:18px">数据目录：<span class="mono">${esc(catalog.studiesRoot || '~/.dsh/reddit-research')}</span></p>
    `
    $app.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`删除调研「${btn.dataset.del}」？（数据与报告全部删除）`)) return
        try {
          await api(`/api/studies/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' })
          toast('已删除')
          renderHome()
        } catch (e) { toast(e.message, true) }
      })
    })
  }

  // ── 调研详情
  route(/^#\/s\/(.+)$/, (name0) => renderStudy(decodeURIComponent(name0)))
  async function renderStudy(name) {
    let d
    try { d = await api(`/api/studies/${encodeURIComponent(name)}`) } catch (e) { $app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
    const a = d.analysis
    const c = d.commentsRes

    const dataHtml = d.data.length
      ? `<div class="card"><table><tr><th>sub</th><th class="num">帖数</th></tr>${d.data.map((x) => `<tr><td>r/${esc(x.sub)}</td><td class="num">${x.count}</td></tr>`).join('')}<tr><td><b>合计</b></td><td class="num"><b>${d.total}</b></td></tr></table></div>`
      : '<div class="empty">还没有数据——下方填 sub 与窗口后点「拉取」</div>'

    const bucketsHtml = a ? `
      <div class="card">
        <div class="stats" style="font-size:13px">
          <span>抱怨 <b>${a.buckets.complaint}</b></span>
          <span>求助 <b>${a.buckets.help}</b></span>
          <span>展示帖剔除 <b>${a.buckets.showcase}</b></span>
          <span>称赞 <b>${a.buckets.praise}</b></span>
          <span>其他 <b>${a.buckets.other}</b></span>
        </div>
        <div class="verdict ${a.showcaseShare > 50 ? 'fail' : a.showcaseShare <= 30 ? 'ok' : 'warn'}" style="margin-top:10px">
          Top30 高互动帖展示帖占比 ${a.showcaseShare}% — ${esc(a.showcaseVerdict)}
        </div>
        ${a.scope ? `<div class="verdict ${a.scope.share < 30 ? 'fail' : a.scope.share < 60 ? 'warn' : 'ok'}" style="margin-top:8px">数据-目标相关性 ${a.scope.share}%（${a.scope.relevant}/${a.scope.total}）— ${esc(a.scope.verdict)}</div>` : ''}
        ${a.promo ? `<div class="verdict ${a.promo.count ? 'warn' : 'ok'}" style="margin-top:8px">KOC 软文检测：${a.promo.count} 帖（${a.promo.share}%）${a.promo.count ? '——被剔除的往往是分数最高的"正面评价"' : '（0 帖不能默认干净，先人工看 top 10）'}</div>` : ''}
      </div>` : '<div class="empty">还没分析——先保存主题表（themes.json，可让 agent 用 action=themes 写），再点「分析」</div>'

    const scorecardHtml = a?.scorecard?.length ? `
      <h2>痛点评分卡（普遍度 × 严重度 × 趋势）</h2>
      <div class="card"><table>
        <tr><th>主题</th><th class="num">痛点帖</th><th class="num">严重度</th><th>趋势</th><th class="num">评分</th></tr>
        ${a.scorecard.slice(0, 15).map((r) => `<tr><td>${esc(r.theme)}</td><td class="num">${r.n}</td><td class="num">${(r.sev * 100).toFixed(0)}%</td><td>${r.arrow} (${esc(r.delta)})</td><td class="num"><b>${r.score}</b></td></tr>`).join('')}
      </table></div>` : ''

    const signalsHtml = a ? `
      <h2>商业信号（帖级）</h2>
      <div class="card"><table><tr><th>信号</th><th class="num">帖数</th><th class="num">占比</th></tr>
      ${Object.entries(a.signals).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.count}</td><td class="num">${v.share}%</td></tr>`).join('')}
      </table></div>` : ''

    const commentsHtml = c ? `
      <h2>评论级分析</h2>
      <div class="card">
        <div class="stats"><span>样本 <b>${c.sample}</b> 条干净评论</span>${c.scope ? `<span>scope 过滤 ${c.scope.before} → ${c.scope.after}</span>` : ''}</div>
        <table style="margin-top:8px"><tr><th>主题</th><th class="num">评论数</th><th class="num">占比</th></tr>
        ${Object.entries(c.themes).sort((x, y) => y[1].count - x[1].count).slice(0, 10).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.count}</td><td class="num">${v.share}%</td></tr>`).join('')}
        </table>
      </div>` : ''

    $app.innerHTML = `
      <a href="#/" class="muted" style="font-size:12px">← 调研库</a>
      <h1>${esc(d.meta?.title || name)}</h1>
      <p class="lead">${esc(d.meta?.question || '')}</p>
      <div class="kv card" style="margin-bottom:16px">
        <dt>subs</dt><dd>${d.meta?.subs?.map((x) => 'r/' + esc(x)).join(', ') || '—'}</dd>
        <dt>时间窗</dt><dd>${d.meta?.days || '—'} 天</dd>
        <dt>样本</dt><dd><b>${d.total}</b> 帖${d.verified ? ` · 报告${d.verified === 'pass' ? ' ✓ 数字闭环通过' : ' ✗ 闭环未通过'}` : ''}</dd>
        <dt>主题表</dt><dd>${d.has_themes ? `${Object.keys(d.themes).length} 主题` : '未保存（action=themes）'}</dd>
        ${d.meta?.scope ? `<dt>scope</dt><dd class="mono" style="font-size:11px">${esc(d.meta.scope)}</dd>` : ''}
      </div>

      <div class="card">
        <div class="row" style="align-items:end">
          <div><label>subs（逗号分隔）</label><input type="text" id="in-subs" value="${esc((d.meta?.subs || []).join(','))}"></div>
          <div style="max-width:110px"><label>窗口天数</label><input type="number" id="in-days" value="${d.meta?.days || 90}"></div>
          <div style="flex:0"><label>&nbsp;</label><button id="btn-probe">探活</button></div>
          <div style="flex:0"><label>&nbsp;</label><button id="btn-fetch">拉取</button></div>
          <div style="flex:0"><label>&nbsp;</label><button id="btn-analyze" ${d.has_themes && d.total ? '' : 'disabled'}>分析</button></div>
          <div style="flex:0"><label>&nbsp;</label><button id="btn-comments" ${a?.commentCandidates?.length ? '' : 'disabled'}>评论补刀</button></div>
          <div style="flex:0"><label>&nbsp;</label><button id="btn-verify" ${d.has_report ? '' : 'disabled'}>校验闭环</button></div>
        </div>
        <div class="toolbar" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
          <button id="btn-chat" class="ghost small">让 agent 处理这个调研</button>
          <span class="muted" style="font-size:12px">拉取可能几分钟（每 100 帖 1 页）；重跑同一命令自动断点续传</span>
        </div>
        <div id="probe-out" class="muted" style="font-size:12px;white-space:pre-wrap"></div>
      </div>

      <h2>数据构成</h2>
      ${dataHtml}
      ${a ? `<h2>五分类 + 数据体检</h2>${bucketsHtml}` : ''}
      ${scorecardHtml}
      ${signalsHtml}
      ${commentsHtml}

      ${d.has_report ? `
      <h2>调研报告 ${d.verified === 'pass' ? '<span class="tag ok">✓ 闭环</span>' : d.verified === 'fail' ? '<span class="tag fail">✗ 未闭环</span>' : '<span class="tag gray">未校验</span>'}</h2>
      <div id="report-box" class="card"><span class="spin"></span></div>` : ''}

      <h2>时间线</h2>
      <div class="card timeline">${d.journal.slice().reverse().slice(0, 30).map((j) => `
        <div class="tl-item ${j.ok ? 'ok' : 'fail'}">
          <span class="ts mono">${esc((j.ts || '').slice(5, 19))}</span>
          <b>${esc(j.action)}</b> — ${esc(j.summary || '')}
        </div>`).join('') || '<div class="empty">暂无</div>'}</div>
    `

    const enc = encodeURIComponent(name)
    document.getElementById('btn-probe')?.addEventListener('click', async (e) => {
      const done = busyBtn(e.target, '探活中…')
      try {
        const r = await apiPost(`/api/studies/${enc}/probe`, { subs: document.getElementById('in-subs').value, days: Number(document.getElementById('in-days').value) || 30 })
        document.getElementById('probe-out').textContent = r.summary || r.results.map((x) => `r/${x.sub}: ${x.verdict}`).join('\n')
        // 探活会把窗口定下来（超预算自动缩）——直接同步到输入框，点「拉取」就是建议值
        if (r.plan?.days) document.getElementById('in-days').value = r.plan.days
        toast(r.plan?.shrunk ? `窗口按预算缩到 ${r.plan.days} 天（${r.plan.pages} 页）——直接拉取即可` : '窗口在预算内——直接拉取即可')
      } catch (err) { toast(err.message, true) } finally { done() }
    })
    document.getElementById('btn-fetch')?.addEventListener('click', async (e) => {
      const done = busyBtn(e.target, '拉取中…')
      try {
        const r = await apiPost(`/api/studies/${enc}/fetch`, { subs: document.getElementById('in-subs').value, days: Number(document.getElementById('in-days').value) || undefined })
        toast(r.summary)
        renderStudy(name)
      } catch (err) { toast(err.message, true); done() }
    })
    document.getElementById('btn-analyze')?.addEventListener('click', async (e) => {
      const done = busyBtn(e.target, '分析中…')
      try {
        const r = await apiPost(`/api/studies/${enc}/analyze`, {})
        toast(r.summary)
        renderStudy(name)
      } catch (err) { toast(err.message, true); done() }
    })
    document.getElementById('btn-comments')?.addEventListener('click', async (e) => {
      const done = busyBtn(e.target, '补刀中…')
      try {
        const r = await apiPost(`/api/studies/${enc}/comments`, {})
        toast(r.summary)
        renderStudy(name)
      } catch (err) { toast(err.message, true); done() }
    })
    document.getElementById('btn-verify')?.addEventListener('click', async (e) => {
      const done = busyBtn(e.target, '校验中…')
      try {
        const r = await apiPost(`/api/studies/${enc}/verify`, {})
        toast(r.summary, !r.ok)
        renderStudy(name)
      } catch (err) { toast(err.message, true); done() }
    })
    document.getElementById('btn-chat')?.addEventListener('click', () => {
      const prompt = `继续 reddit 调研「${name}」：用 reddit_research 检查当前进度（action=read, what=detail），按流程推进下一步（探活定窗→fetch→themes→analyze→comments→report→verify），纪律：结论带原帖链接、只写相关帖、数据不足写需补调研。`
      sendAgentPrompt(prompt, '已开新对话并填入这个调研的推进指令')
    })

    if (d.has_report) {
      api(`/api/studies/${enc}/file?p=report.md`).then((txt) => {
        const box = document.getElementById('report-box')
        if (!box) return
        box.innerHTML = `
          <div class="md-toolbar">
            <span class="muted" style="font-size:12px">渲染视图 · 链接可直接点开</span>
            <span style="flex:1"></span>
            <button id="btn-md-toggle" class="small ghost">查看源码</button>
            <button id="btn-md-copy" class="small ghost">复制 Markdown</button>
          </div>
          <div id="report-md" class="md-body">${mdToHtml(txt)}</div>
          <pre id="report-src" class="report" hidden>${esc(txt)}</pre>`
        const md = box.querySelector('#report-md')
        const srcEl = box.querySelector('#report-src')
        const tg = box.querySelector('#btn-md-toggle')
        let raw = false
        tg.onclick = () => {
          raw = !raw
          md.hidden = raw
          srcEl.hidden = !raw
          tg.textContent = raw ? '渲染视图' : '查看源码'
        }
        box.querySelector('#btn-md-copy').onclick = async () => {
          try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(txt)
            else {
              const ta = document.createElement('textarea')
              ta.value = txt
              ta.style.position = 'fixed'
              ta.style.opacity = '0'
              document.body.appendChild(ta)
              ta.select()
              document.execCommand('copy')
              document.body.removeChild(ta)
            }
            toast('已复制报告 Markdown')
          } catch { toast('复制失败——可切到「查看源码」手动选择', true) }
        }
      }).catch(() => { document.getElementById('report-box').textContent = '报告读取失败' })
    }
  }

  // ── 说明页
  route(/^#\/about$/, () => {
    $app.innerHTML = `
      <h1>流程与纪律</h1>
      <p class="lead">七个步骤，每一步都有上游实测教训背书。违反任何一条都会得出错误结论或浪费大量时间。</p>
      <div class="card" style="line-height:2;font-size:13px">
        <b>1. 探活定窗</b> — probe 拿近 N 天精确帖量（aggregate 端点），页数 = 帖量/100。<b>窗口由 probe 按页数预算（单次 ≤20 页）自动定下并写回调研</b>，超预算按日均自动缩窗（下限 7 天）；agent 照建议值直接拉，不问用户。只有当用户明确要求「拉满 N 年 / 全量」时才照用户的窗口跑并先回报预计耗时。近 N 天 0 帖或日均 &lt;1 帖的 sub 不可用于结论。<br>
        <b>2. 全量拉取</b> — fetch 分页拉帖子（增量落盘+断点续传）。关键词搜索通道过载敏感且品牌名几乎不在标题——全量拉取+本地过滤始终是主路径。422 "Timeout" = 瞬态过载退避重试；400（全站关键词查询）= 形态不允许不重试。<br>
        <b>3. 主题表</b> — 按调研品类重建（模板只参考结构）。<b>短词必须加 \\b 词边界</b>：ap/log/ram/can/pin/doc/ota 裸写会命中 app/happy/program/shipping，主题频次整体虚高。<br>
        <b>4. 帖级分析</b> — 五分类（抱怨/求助/展示/称赞/其他）。<b>判据放标题级</b>：全文过滤会被 score 2000+ 的晒作品帖霸榜（实测 2819→847 帖）。必看 Top30 展示帖占比 &gt;50% = 情感展示型。求助帖单独立类（工程社区抱怨:求助 ≈ 1:3.7）。<br>
        <b>5. 评论树补刀</b> — 只对痛点/口碑层候选抓评论。<b>禁止对全局热度 top 抓评论</b>——那大概率是展示帖，评论只会是 "Awesome!"。自动剔除 [removed]/机器人评论。<br>
        <b>6. 报告</b> — 固定格式（调研结论/关键痛点/矛盾与不确定/来源清单）。<b>每条结论附原帖链接</b>；数据不足写「需补调研：X」禁止凑数编造。<br>
        <b>7. 数字闭环</b> — verify 自动核对每个引用帖 ID/score/comments/日期 vs 数据集。有编造或抄错的引用必须清零再发。<br>
        <b>KOC 软文</b> — 电商/美妆/假发类 analyze 时开 promoCheck（被剔除的恰好是分数最高的"正面评价"）；潮玩实测仅 0.2%——<b>每个品类独立实测</b>。
      </div>
      <h2>合规边界</h2>
      <div class="card" style="line-height:2;font-size:13px">
        定位：个人/一次性市场与产品研究（Arctic Shift 为社区档案，使用通常被默许但无保证）。<b>禁止</b>做成对外产品功能、用于 AI 模型训练、转售数据。<b>只读</b>：不含任何发帖/评论/点赞自动化。公开引用保留原帖链接与作者名。
      </div>
    `
  })

  navigate()
})()
