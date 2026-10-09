import fs from 'fs'
import type { Dirent } from 'fs'
import path from 'path'
import { groupPromptsByProject, parseTime } from './common'
import type { AgentSourceResult } from './common'

type Entry = { project: string; text: string; ts: number }
type Json = Record<string, unknown>

const LABEL = 'Gemini CLI'
const NOT_FOUND = 'Không tìm thấy ~/.gemini/tmp'
const HASH_DIR = /^[0-9a-f]{64}$/
// Nội dung do CLI tự chèn (ví dụ <command-name>...), không phải prompt thật
const INJECTED = /^<[A-Za-z][\w-]*>/

const isObj = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPrompt = (text: string) => {
  const trimmed = text.trim()
  return trimmed.length > 0 && !INJECTED.test(trimmed)
}

// content của user là chuỗi hoặc danh sách part { text } (part functionResponse là kết quả công cụ, bỏ qua)
const userText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (isObj(part) && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

const readText = async (file: string): Promise<string | null> => {
  try {
    return await fs.promises.readFile(file, 'utf8')
  } catch {
    return null
  }
}

const readJsonObject = async (file: string): Promise<Json | null> => {
  const raw = await readText(file)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isObj(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Chat của Gemini CLI có hai dạng:
 * - .json: một object { sessionId, projectHash, startTime, messages[] }
 * - .jsonl: dòng đầu là header (sessionId, projectHash, kind...), các dòng sau là message
 *   { id, timestamp, type, content }; dòng { "$set": ... } là cập nhật metadata.
 * Message được khử trùng theo id (bản ghi sau ghi đè bản trước).
 */
const readChatFile = async (file: string): Promise<{ kind?: string; messages: Json[] } | null> => {
  if (file.endsWith('.json')) {
    const doc = await readJsonObject(file)
    if (!doc) return null
    const messages = Array.isArray(doc.messages) ? doc.messages.filter(isObj) : []
    return { kind: typeof doc.kind === 'string' ? doc.kind : undefined, messages }
  }

  const raw = await readText(file)
  if (raw === null) return null
  let kind: string | undefined
  const byId = new Map<string, Json>()
  const loose: Json[] = []
  let first = true
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(rec)) continue
    if (first) {
      first = false
      if (typeof rec.kind === 'string') kind = rec.kind
    }
    if (rec.type === undefined || rec.content === undefined) continue
    if (typeof rec.id === 'string') byId.set(rec.id, rec)
    else loose.push(rec)
  }
  return { kind, messages: [...byId.values(), ...loose] }
}

/** Ánh xạ projectHash (sha256 của đường dẫn project) về đường dẫn gốc nếu tìm được */
const buildHashMap = async (tmpDir: string, dirNames: string[]): Promise<Map<string, string>> => {
  const candidates = new Set<string>()
  const projects = await readJsonObject(path.join(path.dirname(tmpDir), 'projects.json'))
  if (projects && isObj(projects.projects)) {
    for (const key of Object.keys(projects.projects)) candidates.add(key)
  }
  for (const name of dirNames) {
    if (HASH_DIR.test(name)) continue
    const root = await readText(path.join(tmpDir, name, '.project_root'))
    if (root && root.trim()) candidates.add(root.trim())
  }

  const map = new Map<string, string>()
  for (const candidate of candidates) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidate))
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
      map.set(hex, candidate)
    } catch {
      // bỏ qua ứng viên lỗi
    }
  }
  return map
}

/**
 * Tên project: thư mục có tên thường (ví dụ 'logtime') dùng .project_root nếu có;
 * thư mục băm mà không ánh xạ được thì dùng 8 ký tự đầu của hash.
 */
const resolveProject = async (tmpDir: string, dirName: string, hashMap: Map<string, string>) => {
  if (HASH_DIR.test(dirName)) return hashMap.get(dirName) ?? dirName.slice(0, 8)
  const root = await readText(path.join(tmpDir, dirName, '.project_root'))
  return root && root.trim() ? root.trim() : dirName
}

const readChatsOfProject = async (chatsDir: string, project: string): Promise<Entry[]> => {
  let items: Dirent[]
  try {
    items = await fs.promises.readdir(chatsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Entry[] = []
  for (const item of items) {
    // Thư mục con trong chats là phiên phụ (skill, subagent), không phải prompt do người dùng gõ trực tiếp
    if (!item.isFile() || !/\.jsonl?$/.test(item.name)) continue
    try {
      const chat = await readChatFile(path.join(chatsDir, item.name))
      if (!chat || chat.kind === 'subagent') continue
      for (const msg of chat.messages) {
        if (msg.type !== 'user') continue
        const text = userText(msg.content)
        if (!isPrompt(text)) continue
        out.push({ project, text, ts: parseTime(msg.timestamp) })
      }
    } catch {
      // một file lỗi không làm hỏng các file khác
    }
  }
  return out
}

export const readGeminiCliHistory = async (date: string, homeDir: string): Promise<AgentSourceResult> => {
  const base = { id: 'gemini-cli', label: LABEL }
  const tmpDir = path.join(homeDir, '.gemini', 'tmp')

  try {
    let items: Dirent[]
    try {
      items = await fs.promises.readdir(tmpDir, { withFileTypes: true })
    } catch {
      return { ...base, available: false, error: NOT_FOUND, projects: [] }
    }

    const dirNames = items.filter((i) => i.isDirectory()).map((i) => i.name)
    const hashMap = await buildHashMap(tmpDir, dirNames)

    const entries: Entry[] = []
    for (const dirName of dirNames) {
      const project = await resolveProject(tmpDir, dirName, hashMap)
      entries.push(...(await readChatsOfProject(path.join(tmpDir, dirName, 'chats'), project)))
    }

    return { ...base, available: true, projects: groupPromptsByProject(date, entries) }
  } catch {
    return { ...base, available: false, error: 'Không đọc được lịch sử ~/.gemini/tmp', projects: [] }
  }
}
