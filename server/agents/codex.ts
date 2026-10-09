import fs from 'fs'
import type { Dirent } from 'fs'
import path from 'path'
import { groupPromptsByProject, parseTime } from './common'
import type { AgentSourceResult } from './common'

type Entry = { project: string; text: string; ts: number }
type Json = Record<string, unknown>

const LABEL = 'Codex CLI'
const NOT_FOUND = 'Không tìm thấy ~/.codex/sessions'
// Nội dung do Codex tự chèn vào lượt user (environment_context, AGENTS.md, turn_aborted...), không phải prompt thật
const INJECTED = /^(<|# AGENTS\.md instructions)/

const isObj = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (isObj(part) && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
}

const isPrompt = (text: string) => {
  const trimmed = text.trim()
  return trimmed.length > 0 && !INJECTED.test(trimmed)
}

const findJsonlFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = []
  let items: Dirent[]
  try {
    items = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const item of items) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) {
      out.push(...(await findJsonlFiles(full)))
    } else if (item.isFile() && item.name.endsWith('.jsonl')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Đọc một file rollout của Codex. Mỗi dòng là { timestamp, type, payload }.
 * - cwd của project: payload.cwd trong bản ghi session_meta
 * - prompt thật: event_msg/user_message (payload.message); nếu phiên không có loại này
 *   thì dùng response_item/message có role 'user' (đã lọc nội dung chèn tự động)
 */
const readSession = async (file: string): Promise<Entry[]> => {
  let raw: string
  try {
    raw = await fs.promises.readFile(file, 'utf8')
  } catch {
    return []
  }

  let metaCwd = ''
  let anyCwd = ''
  const userMessages: Entry[] = []
  const responseUsers: Entry[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(rec)) continue

    const payload = isObj(rec.payload) ? rec.payload : {}
    const ts = parseTime(rec.timestamp)

    if (typeof payload.cwd === 'string' && payload.cwd) {
      if (rec.type === 'session_meta' && !metaCwd) metaCwd = payload.cwd
      if (!anyCwd) anyCwd = payload.cwd
    }

    if (rec.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string') {
      userMessages.push({ project: '', text: payload.message, ts })
    } else if (rec.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      responseUsers.push({ project: '', text: textOf(payload.content), ts })
    }
  }

  const project = metaCwd || anyCwd || 'unknown'
  const chosen = userMessages.length > 0 ? userMessages : responseUsers
  return chosen.filter((e) => isPrompt(e.text)).map((e) => ({ ...e, project }))
}

export const readCodexHistory = async (date: string, homeDir: string): Promise<AgentSourceResult> => {
  const base = { id: 'codex', label: LABEL }
  const root = path.join(homeDir, '.codex', 'sessions')

  try {
    let isDir = false
    try {
      isDir = (await fs.promises.stat(root)).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) {
      return { ...base, available: false, error: NOT_FOUND, projects: [] }
    }

    const entries: Entry[] = []
    for (const file of await findJsonlFiles(root)) {
      entries.push(...(await readSession(file)))
    }

    return { ...base, available: true, projects: groupPromptsByProject(date, entries) }
  } catch {
    return { ...base, available: false, error: 'Không đọc được lịch sử ~/.codex/sessions', projects: [] }
  }
}
