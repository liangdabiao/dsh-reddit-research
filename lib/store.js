// Reddit 调研台 · 数据层：$DSH_HOME/reddit-research/<study>/
//   ├── project.json     元数据（研究问题/subs/时间窗/阶段）
//   ├── data/<sub>.json  fetch 产物（+ .jsonl 增量流水 / .meta 采集窗口 / .log 运行日志）
//   ├── themes.json      主题表（{"主题名": "正则"}）
//   ├── analysis.md      帖级分析报告
//   ├── comments.json    评论树补刀产物
//   ├── comments.md      评论级分析
//   ├── report.md        最终调研报告（数字闭环校验对象）
//   └── journal.jsonl    过程时间线
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeJsonAtomic, appendFile } from './util.js'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'reddit-research')

export function studiesRoot(config) {
  const root = config?.studiesRoot || DATA_DIR
  mkdirSync(root, { recursive: true })
  return root
}

export function studyDir(config, name) {
  return join(studiesRoot(config), name)
}

export function readMeta(config, name) {
  const file = join(studyDir(config, name), 'project.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

export function saveMeta(config, name, patch) {
  const dir = studyDir(config, name)
  mkdirSync(dir, { recursive: true })
  const next = { name, ...(readMeta(config, name) || {}), ...patch, updated_at: new Date().toISOString() }
  writeJsonAtomic(join(dir, 'project.json'), next)
  return next
}

export function listStudies(config) {
  const root = studiesRoot(config)
  const out = []
  for (const name of readdirSync(root)) {
    const dir = join(root, name)
    if (!statSync(dir).isDirectory()) continue
    const meta = readMeta(config, name)
    const dataDir = join(dir, 'data')
    const subs = meta?.subs || []
    const withData = subs.filter((s) => existsSync(join(dataDir, `${s}.json`))).length
    out.push({
      name,
      question: meta?.question || '',
      subs,
      days: meta?.days || null,
      with_data: withData,
      has_analysis: existsSync(join(dir, 'analysis.md')),
      has_comments: existsSync(join(dir, 'comments.md')),
      has_report: existsSync(join(dir, 'report.md')),
      verified: meta?.verified ?? null,
      updated_at: meta?.updated_at || null,
    })
  }
  return out.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
}

export function createStudy(config, name, { question, subs, days } = {}) {
  const dir = studyDir(config, name)
  mkdirSync(join(dir, 'data'), { recursive: true })
  const meta = saveMeta(config, name, { name, question: question || '', subs: subs || [], days: days || 90, stage: '采集' })
  return { name, dir, meta }
}

export function deleteStudy(config, name) {
  const dir = studyDir(config, name)
  if (!existsSync(dir)) return { ok: false, error: `调研不存在: ${name}` }
  rmSync(dir, { recursive: true, force: true })
  return { ok: true }
}

export { writeJsonAtomic, appendFile, journal, readJournal, sanitizeName, writeTextAtomic } from './util.js'
