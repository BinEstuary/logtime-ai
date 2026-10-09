// Đọc prompt người dùng trong GitHub Copilot Chat (VS Code) cho một ngày, gom theo workspace.
// Phiên chat nằm ở ~/.config/Code/User/workspaceStorage/<hash>/chatSessions/<sessionId>.json (bản cũ)
// hoặc .jsonl (bản mới: dòng đầu là trạng thái gốc, các dòng sau là patch kind 1 = gán, kind 2 = chèn mảng).
// Cửa sổ không mở thư mục nằm ở ~/.config/Code/User/globalStorage/emptyWindowChatSessions.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { groupPromptsByProject, parseTime, type AgentSourceResult } from './common'

const ID = 'copilot-chat'
const LABEL = 'GitHub Copilot Chat'
const EMPTY_WINDOW_PROJECT = 'Cửa sổ không có thư mục'

type Entry = { project: string; text: string; ts: number }
type Patch = { kind: number; k?: (string | number)[]; v?: unknown; i?: number }

const unavailable = (error: string): AgentSourceResult => ({ id: ID, label: LABEL, available: false, error, projects: [] })

/** Đọc thư mục gốc của workspaceStorage từ workspace.json */
async function readWorkspaceFolder(wsDir: string): Promise<string | undefined> {
  try {
    const meta = JSON.parse(await fs.promises.readFile(path.join(wsDir, 'workspace.json'), 'utf8'))
    const uri: unknown = meta.folder ?? meta.workspace
    if (typeof uri !== 'string' || !uri.startsWith('file://')) return undefined
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

const setPath = (root: any, keys: (string | number)[], value: unknown) => {
  let node = root
  for (const key of keys.slice(0, -1)) {
    if (node[key] === undefined || node[key] === null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys[keys.length - 1]] = value
}

const getPath = (root: any, keys: (string | number)[]) => keys.reduce((node, key) => (node == null ? undefined : node[key]), root)

/** Dựng lại trạng thái phiên từ file .jsonl (log patch); dòng hỏng bị bỏ qua */
function replayJsonl(text: string): any {
  let state: any
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let patch: Patch
    try {
      patch = JSON.parse(line)
    } catch {
      continue
    }
    if (patch.kind === 0) {
      state = patch.v
      continue
    }
    if (state === undefined || !Array.isArray(patch.k) || patch.k.length === 0) continue
    if (patch.kind === 1) {
      setPath(state, patch.k, patch.v)
    } else if (patch.kind === 2) {
      const target = getPath(state, patch.k)
      if (!Array.isArray(target)) continue
      const items = Array.isArray(patch.v) ? patch.v : [patch.v]
      if (typeof patch.i === 'number') target.splice(patch.i, 0, ...items)
      else target.push(...items)
    }
  }
  return state
}

/** Lấy prompt người dùng (requests[].message.text) của một file phiên */
async function readSessionPrompts(file: string, project: string): Promise<Entry[]> {
  const text = await fs.promises.readFile(file, 'utf8')
  const session = file.endsWith('.jsonl') ? replayJsonl(text) : JSON.parse(text)
  const requests: any[] = Array.isArray(session?.requests) ? session.requests : []
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const req of requests) {
    if (typeof req?.requestId === 'string') {
      if (seen.has(req.requestId)) continue
      seen.add(req.requestId)
    }
    const prompt = req?.message?.text
    if (typeof prompt !== 'string') continue
    const ts = parseTime(req.timestamp)
    if (!ts) continue
    entries.push({ project, text: prompt, ts })
  }
  return entries
}

const listSessionFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json') || name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
}

export async function readCopilotChatHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  try {
    const userDir = path.join(homeDir, '.config', 'Code', 'User')
    const wsRoot = path.join(userDir, 'workspaceStorage')
    const emptyDir = path.join(userDir, 'globalStorage', 'emptyWindowChatSessions')
    if (!fs.existsSync(wsRoot) && !fs.existsSync(emptyDir)) {
      return unavailable('Không tìm thấy ~/.config/Code/User/workspaceStorage')
    }

    const entries: Entry[] = []
    const collect = async (files: string[], project: string) => {
      for (const file of files) {
        try {
          entries.push(...(await readSessionPrompts(file, project)))
        } catch {
          // Một phiên hỏng không làm hỏng các phiên khác
        }
      }
    }

    if (fs.existsSync(wsRoot)) {
      for (const name of fs.readdirSync(wsRoot)) {
        const wsDir = path.join(wsRoot, name)
        const files = listSessionFiles(path.join(wsDir, 'chatSessions'))
        if (files.length === 0) continue
        const project = (await readWorkspaceFolder(wsDir)) ?? 'Không rõ thư mục'
        await collect(files, project)
      }
    }
    await collect(listSessionFiles(emptyDir), EMPTY_WINDOW_PROJECT)

    return { id: ID, label: LABEL, available: true, projects: groupPromptsByProject(date, entries) }
  } catch {
    return unavailable('Không đọc được lịch sử Copilot Chat')
  }
}
