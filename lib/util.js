// 通用小件：原子写 JSON、journal、名称净化。
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function writeTextAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

export function appendFile(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, text, 'utf8')
}

export function journal(dir, entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
  try { appendFileSync(join(dir, 'journal.jsonl'), line, 'utf8') } catch { /* ignore */ }
}

export function readJournal(dir, limit = 100) {
  const file = join(dir, 'journal.jsonl')
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } })
}

export function sanitizeName(raw) {
  const clean = String(raw || '')
    .replace(/[\s\\/:*?"<>|.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return clean || 'study'
}
