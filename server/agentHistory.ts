// Đọc lịch sử làm việc với các AI agent trên máy (Claude Code, Antigravity) cho một ngày cụ thể.
// Chạy trong Vite dev server (Node), được gọi qua endpoint /api/agent-history.
import fs from 'fs'
import path from 'path'
import os from 'os'

const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const MAX_PROMPT_CHARS = 220
const MAX_PROMPTS_PER_PROJECT = 25
const MAX_NOTE_CHARS = 500
// Khoảng lặng tối đa giữa 2 prompt vẫn được tính là đang làm việc liên tục
const MAX_ACTIVE_GAP_MIN = 30
const TAIL_AFTER_LAST_PROMPT_MIN = 10

import { AGENT_READERS, AGENT_READER_IDS, type AgentReaderId, type AgentSourceResult } from './agents'

export type AgentSource = 'claude' | 'antigravity' | AgentReaderId
export const ALL_AGENT_SOURCES: AgentSource[] = ['claude', 'antigravity', ...AGENT_READER_IDS]

export interface ClaudeProjectActivity {
  project: string
  name: string
  prompts: string[]
  promptCount: number
  firstAt: string
  lastAt: string
  estimatedMinutes: number
}

export interface AntigravityConversation {
  id: string
  title: string
  workspace: string
  lastActiveAt: string
  steps: number
  notes?: string
}

export interface AgentHistoryResult {
  date: string
  claude?: { available: boolean; error?: string; projects: ClaudeProjectActivity[] }
  antigravity?: { available: boolean; error?: string; conversations: AntigravityConversation[] }
  /** Các nguồn khác (Codex, Gemini CLI, Kiro, Goose, opencode, Zed, Copilot CLI, Cline...) */
  agents?: AgentSourceResult[]
}

const historyHome = () => process.env.AGENT_HISTORY_HOME || os.homedir()

const toVnDate = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10)
const toVnTime = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(11, 16)

// Che các chuỗi trông giống secret trước khi gửi nội dung đi tóm tắt
export const redact = (text: string) =>
  text
    .replace(/\b(sk|gsk|ghp|gho|xox[abp]|AKIA)[-_A-Za-z0-9]{12,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|passwd|secret)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}\b/g, '[REDACTED]')

const clip = (text: string, max: number) => {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine
}

// Prompt chỉ là lệnh điều khiển CLI (/clear, /model, ...) thì không phản ánh công việc
const isControlCommand = (text: string) => /^\/[\w:-]+(\s+\S+)?$/.test(text.trim())

const estimateActiveMinutes = (timestamps: number[]) => {
  if (timestamps.length === 0) return 0
  const sorted = [...timestamps].sort((a, b) => a - b)
  let minutes = TAIL_AFTER_LAST_PROMPT_MIN
  for (let i = 1; i < sorted.length; i++) {
    minutes += Math.min((sorted[i] - sorted[i - 1]) / 60000, MAX_ACTIVE_GAP_MIN)
  }
  return Math.round(minutes)
}

function readClaudeHistory(date: string): AgentHistoryResult['claude'] {
  const file = path.join(historyHome(), '.claude', 'history.jsonl')
  if (!fs.existsSync(file)) {
    return { available: false, error: 'Không tìm thấy ~/.claude/history.jsonl', projects: [] }
  }

  const byProject = new Map<string, { prompts: string[]; times: number[] }>()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const ts = Number(entry.timestamp)
    const text = typeof entry.display === 'string' ? entry.display : ''
    if (!ts || toVnDate(ts) !== date || !text.trim() || isControlCommand(text)) continue

    const project = entry.project || 'unknown'
    const bucket = byProject.get(project) || { prompts: [], times: [] }
    bucket.prompts.push(clip(redact(text), MAX_PROMPT_CHARS))
    bucket.times.push(ts)
    byProject.set(project, bucket)
  }

  const projects = [...byProject.entries()].map(([project, { prompts, times }]) => ({
    project,
    name: path.basename(project),
    prompts: prompts.slice(0, MAX_PROMPTS_PER_PROJECT),
    promptCount: prompts.length,
    firstAt: toVnTime(Math.min(...times)),
    lastAt: toVnTime(Math.max(...times)),
    estimatedMinutes: estimateActiveMinutes(times),
  }))
  projects.sort((a, b) => b.estimatedMinutes - a.estimatedMinutes)
  return { available: true, projects }
}

// Antigravity lưu thời gian dạng "2026-07-27 09:12:17.642126062+00:00"
const parseAntigravityTime = (value: string) => {
  const normalized = String(value).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  const ms = Date.parse(normalized)
  return Number.isNaN(ms) ? 0 : ms
}

const readBrainNotes = (dir: string, conversationId: string) => {
  for (const name of ['walkthrough.md', 'task.md', 'implementation_plan.md']) {
    const file = path.join(dir, 'brain', conversationId, name)
    if (fs.existsSync(file)) {
      return clip(redact(fs.readFileSync(file, 'utf8')), MAX_NOTE_CHARS)
    }
  }
  return undefined
}

async function readAntigravityHistory(date: string): Promise<AgentHistoryResult['antigravity']> {
  const geminiDir = path.join(historyHome(), '.gemini')
  const dirs = ['antigravity', 'antigravity-cli', 'antigravity-ide']
    .map((d) => path.join(geminiDir, d))
    .filter((d) => fs.existsSync(path.join(d, 'conversation_summaries.db')))
  if (dirs.length === 0) {
    return { available: false, error: 'Không tìm thấy dữ liệu Antigravity trong ~/.gemini', conversations: [] }
  }

  let DatabaseSync: any
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return { available: false, error: 'Cần Node.js >= 22.13 (node:sqlite) để đọc lịch sử Antigravity', conversations: [] }
  }

  const conversations = new Map<string, AntigravityConversation>()
  const errors: string[] = []
  for (const dir of dirs) {
    // Copy ra thư mục tạm để không tranh khoá với Antigravity đang chạy và đọc được cả khi mount read-only
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'))
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        const src = path.join(dir, 'conversation_summaries.db' + suffix)
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, 'db' + suffix))
      }
      const db = new DatabaseSync(path.join(tmpDir, 'db'))
      const rows = db
        .prepare(
          `SELECT conversation_id, title, preview, workspace_uris, step_count, last_user_input_time, last_modified_time
           FROM conversation_summaries`
        )
        .all()
      db.close()

      for (const row of rows) {
        const lastInput = parseAntigravityTime(row.last_user_input_time)
        const lastModified = parseAntigravityTime(row.last_modified_time)
        const activeOnDate = [lastInput, lastModified].some((ms) => ms && toVnDate(ms) === date)
        if (!activeOnDate || conversations.has(row.conversation_id)) continue

        let workspace = ''
        try {
          const uris = JSON.parse(row.workspace_uris || '[]')
          workspace = uris.length ? path.basename(decodeURI(String(uris[0]).replace('file://', ''))) : ''
        } catch {
          workspace = ''
        }

        conversations.set(row.conversation_id, {
          id: row.conversation_id,
          title: clip(redact(row.title || row.preview || '(không có tiêu đề)'), MAX_PROMPT_CHARS),
          workspace,
          lastActiveAt: toVnTime(Math.max(lastInput, lastModified)),
          steps: Number(row.step_count) || 0,
          notes: readBrainNotes(dir, row.conversation_id),
        })
      }
    } catch (e: any) {
      errors.push(`${path.basename(dir)}: ${e.message}`)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  return {
    available: true,
    error: errors.length ? errors.join('; ') : undefined,
    conversations: [...conversations.values()].sort((a, b) => b.steps - a.steps),
  }
}

// Đọc lịch sử các agent khá nặng (parse nhiều file, copy DB), nên giữ kết quả ngắn hạn để mở lại modal nhanh
const AGENT_CACHE_TTL_MS = 2 * 60 * 1000
const agentCache = new Map<string, { at: number; value: AgentSourceResult }>()

export async function readAgentHistory(date: string, sources: AgentSource[]): Promise<AgentHistoryResult> {
  const result: AgentHistoryResult = { date }
  if (sources.includes('claude')) {
    try {
      result.claude = readClaudeHistory(date)
    } catch (e: any) {
      result.claude = { available: false, error: e.message, projects: [] }
    }
  }
  if (sources.includes('antigravity')) {
    result.antigravity = await readAntigravityHistory(date)
  }
  const readers = AGENT_READER_IDS.filter((id) => sources.includes(id))
  if (readers.length > 0) {
    // Các nguồn đọc song song; một nguồn lỗi không làm hỏng các nguồn khác
    result.agents = await Promise.all(
      readers.map(async (id) => {
        const key = `${id}|${date}|${historyHome()}`
        const cached = agentCache.get(key)
        if (cached && Date.now() - cached.at < AGENT_CACHE_TTL_MS) return cached.value
        try {
          const value = await AGENT_READERS[id](date, historyHome())
          agentCache.set(key, { at: Date.now(), value })
          return value
        } catch (e: any) {
          return { id, label: id, available: false, error: e.message, projects: [] }
        }
      })
    )
  }
  return result
}
