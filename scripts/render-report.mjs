// 开发校验脚本：把 lab/app.js 里的 Markdown 渲染器抽出来跑真实报告，检查结构是否完好。
// 用法：node scripts/render-report.mjs <report.md> [out.html]
import { readFileSync, writeFileSync } from 'node:fs'

const [, , mdPath = 'C:/Users/49707/.dsh/reddit-research/假发品类调研/report.md', outPath] = process.argv
const app = readFileSync(new URL('../lab/app.js', import.meta.url), 'utf8')
const start = app.indexOf('  const MD_BLOCK')
const end = app.indexOf('  const weight = (p) =>')
if (start < 0 || end < 0) throw new Error('未找到渲染器代码块')

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const factory = new Function('esc', `${app.slice(start, end)}\n  return mdToHtml`)
const mdToHtml = factory(esc)

const md = readFileSync(mdPath, 'utf8')
const html = mdToHtml(md)
const css = readFileSync(new URL('../lab/style.css', import.meta.url), 'utf8')

const count = (re) => (html.match(re) || []).length
const stats = {
  tables: count(/<table class="md-table">/g),
  headings: count(/<h[1-4]>/g),
  links: count(/<a href="/g),
  bold: count(/<b>/g),
  lists: count(/<(ul|ol)>/g),
  paragraphs: count(/<p>/g),
  suspiciousRaw: count(/(^|>)\s*#{2,}\s/g), // 未解析的标题
  unclosedTable: count(/<table(?![^>]*>)/g),
}
console.log('md chars:', md.length, '→ html chars:', html.length)
console.log(stats)
if (outPath) writeFileSync(outPath, `<!doctype html><meta charset="utf-8"><style>${css}</style><body style="max-width:820px;margin:40px auto"><div class="card md-body">${html}</div></body>`)
