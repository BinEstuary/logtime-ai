// Đọc prompt của người dùng từ phiên GitHub Copilot CLI (~/.copilot/session-state/<id>/events.jsonl).
import fs from 'fs'
import path from 'path'
import { groupPromptsByProject, parseTime, type AgentSourceResult } from './common'

const ID = 'copilot-cli'
const LABEL = 'GitHub Copilot CLI'
const ROOT_DISPLAY = '~/.copilot/session-state'

interface Entry {
  project: string
  text: string
  ts: number
}

const dayStart = (date: string) => Date.parse(`${date}T00:00:00+07:00`)

// workspace.yaml lưu thư mục làm việc của phiên dưới khoá cwd
const readCwd = (file: string): string | undefined => {
  if (!fs.existsSync(file)) return undefined
  const match = fs.readFileSync(file, 'utf8').match(/^cwd:\s*(.+)$/m)
  const value = match?.[1].trim().replace(/^['"]|['"]$/g, '')
  return value || undefined
}

// Chỉ lấy sự kiện user.message do người dùng gõ; prompt do sub-agent sinh ra có parentAgentTaskId
const readSessionEntries = (sessionDir: string, sessionId: string, date: string): Entry[] => {
  const events = path.join(sessionDir, 'events.jsonl')
  if (!fs.existsSync(events)) return []
  // events.jsonl được ghi thêm theo thời gian, nên mtime nhỏ hơn đầu ngày thì không có prompt trong ngày
  if (fs.statSync(events).mtimeMs < dayStart(date)) return []

  const project = readCwd(path.join(sessionDir, 'workspace.yaml')) || sessionId
  const entries: Entry[] = []
  for (const line of fs.readFileSync(events, 'utf8').split('\n')) {
    if (!line.includes('"user.message"')) continue
    try {
      const event = JSON.parse(line)
      if (event.type !== 'user.message' || event.data?.parentAgentTaskId) continue
      const text = event.data?.content
      if (typeof text !== 'string') continue
      entries.push({ project, text, ts: parseTime(event.timestamp) })
    } catch {
      // Dòng JSON hỏng thì bỏ qua
    }
  }
  return entries
}

export async function readCopilotCliHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  const base = { id: ID, label: LABEL }
  const root = path.join(homeDir, '.copilot', 'session-state')
  try {
    if (!fs.existsSync(root)) {
      return { ...base, available: false, error: `Không tìm thấy ${ROOT_DISPLAY}`, projects: [] }
    }
    const entries: Entry[] = []
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      try {
        entries.push(...readSessionEntries(path.join(root, dir.name), dir.name, date))
      } catch {
        // Phiên hỏng thì bỏ qua, các phiên khác vẫn đọc được
      }
    }
    return { ...base, available: true, projects: groupPromptsByProject(date, entries) }
  } catch {
    return { ...base, available: false, error: `Không đọc được ${ROOT_DISPLAY}`, projects: [] }
  }
}
