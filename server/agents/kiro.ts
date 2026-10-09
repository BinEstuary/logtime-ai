import fs from 'fs/promises'
import path from 'path'
import { VN_OFFSET_MS, groupPromptsByProject, parseTime, type AgentSourceResult } from './common'

const LABEL = 'Kiro CLI'
const DAY_MS = 24 * 60 * 60 * 1000

interface KiroEntry {
  project: string
  text: string
  ts: number
}

/** Đọc cwd (thư mục làm việc) từ file .json đi kèm mỗi phiên */
async function readSessionCwd(jsonFile: string): Promise<string> {
  try {
    const meta = JSON.parse(await fs.readFile(jsonFile, 'utf8'))
    return typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : ''
  } catch {
    return ''
  }
}

/** Lấy các prompt của người dùng (kind 'Prompt') trong một file .jsonl */
function extractPrompts(raw: string, project: string): KiroEntry[] {
  const entries: KiroEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line)
      if (obj?.kind !== 'Prompt') continue
      const content = Array.isArray(obj.data?.content) ? obj.data.content : []
      const text = content
        .filter((c: any) => c?.kind === 'text' && typeof c.data === 'string')
        .map((c: any) => c.data)
        .join('\n')
      const ts = parseTime(obj.data?.meta?.timestamp)
      if (text.trim()) entries.push({ project, text, ts })
    } catch {
      // Dòng lỗi thì bỏ qua, không ảnh hưởng các dòng khác
    }
  }
  return entries
}

export async function readKiroHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  const sessionDir = path.join(homeDir, '.kiro', 'sessions', 'cli')
  const missing = (): AgentSourceResult => ({
    id: 'kiro',
    label: LABEL,
    available: false,
    error: 'Không tìm thấy ~/.kiro/sessions/cli',
    projects: [],
  })

  let names: string[]
  try {
    names = await fs.readdir(sessionDir)
  } catch {
    return missing()
  }

  // Chỉ xét file có thể chứa prompt của ngày đó: sửa đổi sau ngày đầu (theo giờ VN) trừ 1 ngày
  const dayStartMs = Date.parse(`${date}T00:00:00Z`) - VN_OFFSET_MS
  const entries: KiroEntry[] = []
  const errors: string[] = []

  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(sessionDir, name)
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.mtimeMs < dayStartMs - DAY_MS) continue

      const cwd = await readSessionCwd(file.replace(/\.jsonl$/, '.json'))
      const project = cwd || '(không rõ thư mục)'
      const raw = await fs.readFile(file, 'utf8')
      entries.push(...extractPrompts(raw, project))
    } catch (e: any) {
      errors.push(`${name}: ${e?.message ?? 'lỗi không xác định'}`)
    }
  }

  return {
    id: 'kiro',
    label: LABEL,
    available: true,
    error: errors.length ? errors.slice(0, 5).join('; ') : undefined,
    projects: groupPromptsByProject(date, entries),
  }
}
