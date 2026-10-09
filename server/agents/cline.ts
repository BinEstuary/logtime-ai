// Đọc prompt của người dùng từ các task của Cline, Kilo Code, Roo Code (extension VS Code/Cursor/...).
// Mỗi task nằm ở <globalStorage>/<extension>/tasks/<taskId>/api_conversation_history.json
import fs from 'fs'
import path from 'path'
import { groupPromptsByProject, parseTime, type AgentSourceResult } from './common'

const ID = 'cline'
const LABEL = 'Cline / Kilo / Roo Code'
const STORAGE_DISPLAY = '~/.config/<IDE>/User/globalStorage/<extension>/tasks'
// saoudrizwan.claude-dev (Cline), kilocode.kilo-code, rooveterinaryinc.roo-cline, pearai.pearai-roo-cline...
const EXTENSION_PATTERN = /claude-dev|cline|kilo|roo/i
const MIN_PROJECT_SEGMENTS = 3

interface Entry {
  project: string
  text: string
  ts: number
}

const dayStart = (date: string) => Date.parse(`${date}T00:00:00+07:00`)

const subdirs = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

// Tìm các thư mục tasks của extension trong mọi IDE dựa trên VS Code (Code, Cursor, Antigravity, PearAI...)
const findTaskRoots = (homeDir: string): string[] => {
  const storageDirs = [
    ...subdirs(path.join(homeDir, '.config')).map((ide) => path.join(homeDir, '.config', ide, 'User', 'globalStorage')),
    path.join(homeDir, '.vscode-server', 'data', 'User', 'globalStorage'),
  ]
  const roots: string[] = []
  for (const storage of storageDirs) {
    for (const ext of subdirs(storage)) {
      if (!EXTENSION_PATTERN.test(ext)) continue
      const tasks = path.join(storage, ext, 'tasks')
      if (fs.existsSync(tasks)) roots.push(tasks)
    }
  }
  return roots
}

// Tin nhắn tự động của agent (kết quả công cụ, lỗi, nhắc nhở) có dạng [read_file for '...'] hoặc [ERROR]
const isSystemInjected = (text: string) => /^\[(ERROR|TASK)/.test(text) || /^\[[a-z_]+( for [^\]]*)?\]/.test(text)

// Chỉ lấy phần text của người dùng: bỏ environment_details, bỏ thẻ <task> bao quanh prompt đầu tiên
const userPromptText = (content: unknown): string => {
  const blocks: string[] = typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.map((b: any) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).filter(Boolean)
      : []
  const text = blocks
    .map((t) => t.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, '').replace(/<\/?task>/g, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  return text && !isSystemInjected(text) ? text : ''
}

// Project = thư mục chung sâu nhất của các file task đã đụng tới (task_metadata.files_in_context và tool_use.path)
const commonProjectDir = (paths: string[]): string | undefined => {
  const absolute = paths.filter((p) => path.isAbsolute(p))
  if (absolute.length === 0) return undefined
  let common = path.dirname(absolute[0]).split(path.sep).filter(Boolean)
  for (const p of absolute.slice(1)) {
    const segments = path.dirname(p).split(path.sep).filter(Boolean)
    let i = 0
    while (i < common.length && i < segments.length && common[i] === segments[i]) i++
    common = common.slice(0, i)
  }
  // Thư mục quá nông (ví dụ /home/user) thường là gộp nhiều project, coi như không xác định
  return common.length >= MIN_PROJECT_SEGMENTS ? path.sep + common.join(path.sep) : undefined
}

// checkpoints/.git/config của task (git shadow repo) lưu core.worktree = thư mục workspace thật
const readCheckpointWorktree = (taskDir: string): string | undefined => {
  const config = path.join(taskDir, 'checkpoints', '.git', 'config')
  if (!fs.existsSync(config)) return undefined
  const value = fs.readFileSync(config, 'utf8').match(/^\s*worktree\s*=\s*(.+)$/m)?.[1].trim()
  return value && path.isAbsolute(value) ? value : undefined
}

const taskProject = (taskDir: string, messages: any[]): string | undefined => {
  const worktree = readCheckpointWorktree(taskDir)
  if (worktree) return worktree
  const paths: string[] = []
  const meta = readJson(path.join(taskDir, 'task_metadata.json'))
  for (const file of meta?.files_in_context ?? []) {
    if (typeof file?.path === 'string') paths.push(file.path)
  }
  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      const p = block?.type === 'tool_use' ? block.input?.path : undefined
      if (typeof p === 'string') paths.push(p)
    }
  }
  return commonProjectDir(paths)
}

const readTaskEntries = (taskDir: string, taskId: string, date: string): Entry[] => {
  const file = path.join(taskDir, 'api_conversation_history.json')
  if (!fs.existsSync(file)) return []
  if (fs.statSync(file).mtimeMs < dayStart(date)) return []
  const messages = readJson(file)
  if (!Array.isArray(messages)) return []

  // Không có cwd được lưu trong task: dùng thư mục chung của file đã đụng tới, nếu không có thì dùng tên thư mục task
  const project = taskProject(taskDir, messages) || taskId
  const entries: Entry[] = []
  for (const message of messages) {
    if (message?.role !== 'user') continue
    const text = userPromptText(message.content)
    if (!text) continue
    entries.push({ project, text, ts: parseTime(message.ts) })
  }
  return entries
}

export async function readClineFamilyHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  const base = { id: ID, label: LABEL }
  try {
    const roots = findTaskRoots(homeDir)
    if (roots.length === 0) {
      return { ...base, available: false, error: `Không tìm thấy thư mục task của Cline / Kilo / Roo Code trong ${STORAGE_DISPLAY}`, projects: [] }
    }
    const entries: Entry[] = []
    for (const root of roots) {
      for (const taskId of subdirs(root)) {
        try {
          entries.push(...readTaskEntries(path.join(root, taskId), taskId, date))
        } catch {
          // Task hỏng thì bỏ qua
        }
      }
    }
    return { ...base, available: true, projects: groupPromptsByProject(date, entries) }
  } catch {
    return { ...base, available: false, error: `Không đọc được ${STORAGE_DISPLAY}`, projects: [] }
  }
}
