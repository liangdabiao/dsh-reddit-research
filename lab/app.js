// Reddit 调研台 · 面板逻辑：调研库 → 调研详情（数据构成/五分类/评分卡/商业信号/报告+闭环状态）。
// 抓取与分析重活在对话里让 agent 跑（fetch 可能几分钟）；面板提供探活/拉取/分析/校验直调与全部只读视图。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

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
      : '<div class="empty">还没有调研——在对话里让 agent 用 reddit_research(action="create") 建一个（先钉死研究问题）。</div>'

    $app.innerHTML = `
      <h1>Reddit 调研台</h1>
      <p class="lead">Arctic Shift 免认证档案 API（数据滞后约 36h）。流程：探活估样本量 → 全量拉取（断点续传）→ 主题表 → 帖级分析（五分类+评分卡）→ 评论树补刀 → 报告 + 数字闭环校验。全部结论带原帖链接可复算。</p>
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
        document.getElementById('probe-out').textContent = r.results.map((x) => `r/${x.sub}: ${x.verdict}${x.count !== null ? `（近${x.per_day * (x.count / x.per_day || 30)}天 ${x.count} 帖，页数≈${Math.ceil((x.count || 0) / 100)}）` : ''}`).join('\n')
        toast('探活完成——把页数报给用户确认窗口后再拉取')
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
      const prompt = `继续 reddit 调研「${name}」：用 reddit_research 检查当前进度（action=read, what=detail），按流程推进下一步（探活确认→fetch→themes→analyze→comments→report→verify），纪律：结论带原帖链接、只写相关帖、数据不足写需补调研。`
      try { parent.postMessage({ type: 'reddit-research:refresh', prompt }, location.origin) } catch {}
      toast('已发送到对话')
    })
    addEventListener('message', (e) => {
      if (e.data?.type === 'reddit-research:start-ok') toast('已开新对话并填入草稿')
      if (e.data?.type === 'reddit-research:start-failed') toast('开新对话失败：' + (e.data.message || ''), true)
    })

    if (d.has_report) {
      api(`/api/studies/${enc}/file?p=report.md`).then((txt) => {
        document.getElementById('report-box').innerHTML = `<pre class="report">${esc(txt)}</pre>`
      }).catch(() => { document.getElementById('report-box').textContent = '报告读取失败' })
    }
  }

  // ── 说明页
  route(/^#\/about$/, () => {
    $app.innerHTML = `
      <h1>流程与纪律</h1>
      <p class="lead">七个步骤，每一步都有上游实测教训背书。违反任何一条都会得出错误结论或浪费大量时间。</p>
      <div class="card" style="line-height:2;font-size:13px">
        <b>1. 探活</b> — probe 拿近 N 天精确帖量（aggregate 端点），页数 = 帖量/100。<b>把页数报给用户确认窗口</b>——时间窗不能拍脑袋（实测 540 天窗口 = 89 页串行 40 分钟）。近 N 天 0 帖或日均 &lt;1 帖的 sub 不可用于结论。<br>
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
