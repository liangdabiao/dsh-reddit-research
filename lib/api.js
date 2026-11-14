// 面板数据面：/reddit-research 前缀路由（调研列表/详情/探活/拉取/分析/校验直调 + lab 静态文件）。
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listStudies, deleteStudy, studyDetail, probe, fetchStudy,
  analyzeStudy, commentsStudy, verifyStudy,
} from './ops.js'
import { studyDir } from './store.js'
import { FEED_SUBS, FEED_GROUPS, fetchFeedPage, fetchFeedMulti } from './feed.js'

const BASE = '/reddit-research'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))
const PLUGIN_ROOT = dirname(LAB)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8',
}

function json(res, statusCode, value) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false
  return connection.requestRejection({ headers: req.headers })
}

function serveFile(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

function readJson(req, max = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > max) req.destroy(); else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

function safeFile(dir, rel) {
  if (!dir || String(rel).split(/[\\/]/).some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(dir) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

export function registerApi(ctx, hooks = {}) {
  const configRef = hooks
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        if (!url.pathname.startsWith(BASE + '/') && url.pathname !== BASE) return json(res, 404, { error: 'not found' })
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'
        const config = configRef.config

        if ((req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/')) {
          const file = safeFile(LAB, path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
          if (file) return serveFile(req, res, file)
        }

        if (path === '/api/catalog' && req.method === 'GET') {
          return json(res, 200, {
            version: readVersion(),
            studiesRoot: config?.studiesRoot || null,
            studies: listStudies(config),
          })
        }

        // ── 海外动态：16 个精选社区目录 + 最新帖流（分页 before 游标）
        if (path === '/api/feed/catalog' && req.method === 'GET') {
          return json(res, 200, { groups: FEED_GROUPS, subs: FEED_SUBS, note: 'Arctic Shift 数据滞后约 36h；月访问量为参考值' })
        }
        if (path === '/api/feed' && req.method === 'GET') {
          try {
            const sub = url.searchParams.get('sub') || ''
            const before = url.searchParams.get('before')
            const limit = url.searchParams.get('limit') || 100
            if (sub) {
              const r = await fetchFeedPage(sub, { before, limit })
              return json(res, 200, r)
            }
            // 无 sub = 全部 16 社区混排（各拉一页，串行限速）
            const multi = await fetchFeedMulti(FEED_SUBS.map((x) => x.sub), { limit: 25 })
            const posts = multi.filter((x) => x.ok).flatMap((x) => x.posts).sort((a, b) => (b.created_utc || 0) - (a.created_utc || 0)).slice(0, 100)
            return json(res, 200, { sub: null, posts, nextBefore: null, failures: multi.filter((x) => !x.ok).map((x) => x.sub) })
          } catch (e) { return json(res, 502, { error: e.message }) }
        }

        // 调研目录内白名单文件（data/analysis.md/comments.md/report.md/journal 等）
        const sMatch = path.match(/^\/api\/studies\/([^/]+)(\/.*)?$/)
        if (sMatch) {
          const name = sMatch[1]
          const sub = sMatch[2] || ''
          if (!sub && req.method === 'GET') {
            const detail = studyDetail(config, name)
            if (!detail) return json(res, 404, { error: `调研不存在: ${name}` })
            return json(res, 200, detail)
          }
          if (!sub && req.method === 'DELETE') return json(res, 200, deleteStudy(config, name))
          if (sub === '/probe' && req.method === 'POST') {
            try {
              const body = await readJson(req)
              const r = await probe(config, name, String(body.subs || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean), { days: body.days || 30 })
              return json(res, 200, { ok: true, results: r.results, plan: r.plan, summary: r.summary })
            } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
          }
          if (sub === '/fetch' && req.method === 'POST') {
            try {
              const body = await readJson(req)
              const r = await fetchStudy(config, name, {
                subs: body.subs ? String(body.subs).split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
                days: body.days, fresh: Boolean(body.fresh), maxPages: Math.min(Number(body.maxPages) || config?.maxPages || 600, 2000),
              })
              return json(res, 200, { ok: true, summary: r.summary, results: r.results })
            } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
          }
          if (sub === '/analyze' && req.method === 'POST') {
            try {
              const body = await readJson(req).catch(() => ({}))
              const r = analyzeStudy(config, name, { scope: body.scope, promoCheck: Boolean(body.promoCheck) })
              return json(res, 200, { ok: true, summary: r.summary, result: r.result })
            } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
          }
          if (sub === '/comments' && req.method === 'POST') {
            try {
              const body = await readJson(req).catch(() => ({}))
              const r = await commentsStudy(config, name, { ids: body.ids, scope: body.scope, top: body.top })
              return json(res, 200, { ok: true, summary: r.summary, count: r.count })
            } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
          }
          if (sub === '/verify' && req.method === 'POST') {
            try {
              await readJson(req).catch(() => ({}))
              const r = verifyStudy(config, name)
              return json(res, 200, { ok: r.ok, summary: r.summary, problems: r.problems })
            } catch (e) { return json(res, 400, { ok: false, error: e.message }) }
          }
          if (sub === '/file' && (req.method === 'GET' || req.method === 'HEAD')) {
            const p = url.searchParams.get('p') || ''
            const file = safeFile(studyDir(config, name), p)
            if (!file) return json(res, 404, { error: '文件不存在或不在白名单内' })
            return serveFile(req, res, file)
          }
          return json(res, 404, { error: 'not found' })
        }

        if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' })
        return json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err?.message || '内部错误' })
      }
    },
  })
}

function readVersion() {
  try { return JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')).version } catch { return '' }
}
