// Đọc prompt của người dùng từ lịch sử AI thread của Zed (threads/threads.db, dữ liệu nén zstd).
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { groupPromptsByProject, parseTime, type AgentSourceResult } from './common'

const ID = 'zed'
const LABEL = 'Zed AI'
const DB_DISPLAY = '~/.local/share/zed/threads/threads.db'
const UNKNOWN_PROJECT = 'Không rõ project'
const DAY_MS = 24 * 60 * 60 * 1000

interface ZedThreadRow {
  id: string
  created_at: string | null
  updated_at: string
  data_type: string
  data: Uint8Array
  parent_id: string | null
  folder_paths: string | null
}

interface Entry {
  project: string
  text: string
  ts: number
}

const dayStart = (date: string) => Date.parse(`${date}T00:00:00+07:00`)

// Thread có thể chứa prompt của ngày nếu được tạo trước cuối ngày và cập nhật sau đầu ngày
const mayContainDay = (row: ZedThreadRow, date: string) => {
  const start = dayStart(date)
  const created = parseTime(row.created_at) || parseTime(row.updated_at)
  const updated = parseTime(row.updated_at)
  return created < start + DAY_MS && updated >= start
}

const decodeThread = (row: ZedThreadRow): any => {
  const bytes = Buffer.from(row.data)
  const raw = row.data_type === 'zstd' ? zlib.zstdDecompressSync(bytes) : bytes
  return JSON.parse(raw.toString('utf8'))
}

// folder_paths lưu một đường dẫn hoặc danh sách JSON; dự phòng bằng worktree trong snapshot
const projectOf = (row: ZedThreadRow, json: any): string => {
  const raw = (row.folder_paths || '').trim()
  let fromRow = raw.split('\n')[0]?.trim() || ''
  if (raw.startsWith('[')) {
    try {
      fromRow = String(JSON.parse(raw)[0] || '')
    } catch {
      fromRow = ''
    }
  }
  const snapshot = json?.initial_project_snapshot?.worktree_snapshots?.[0]?.worktree_path
  return fromRow || (typeof snapshot === 'string' && snapshot) || UNKNOWN_PROJECT
}

// Thread của Zed không lưu mốc thời gian cho từng tin nhắn: tin đầu lấy created_at, các tin sau lấy updated_at
const collectEntries = (rows: ZedThreadRow[], date: string): Entry[] => {
  const entries: Entry[] = []
  for (const row of rows) {
    if (row.parent_id || !mayContainDay(row, date)) continue
    try {
      const json = decodeThread(row)
      const project = projectOf(row, json)
      const created = parseTime(row.created_at) || parseTime(row.updated_at)
      const updated = parseTime(row.updated_at) || created
      let userIndex = 0
      for (const message of json?.messages ?? []) {
        if (!message?.User) continue
        const text = (message.User.content ?? [])
          .map((block: any) => (typeof block?.Text === 'string' ? block.Text : ''))
          .filter(Boolean)
          .join('\n')
        entries.push({ project, text, ts: userIndex === 0 ? created : updated })
        userIndex++
      }
    } catch {
      // Bỏ qua thread hỏng, không làm hỏng cả nguồn
    }
  }
  return entries
}

async function readEntries(dbFile: string, date: string): Promise<Entry[]> {
  // Copy ra thư mục tạm để không tranh khoá với Zed đang chạy
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logtime-zed-'))
  let db: { prepare: (sql: string) => { all: () => unknown[] }; close: () => void } | undefined
  try {
    const name = path.basename(dbFile)
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(dbFile + suffix)) fs.copyFileSync(dbFile + suffix, path.join(tmpDir, name + suffix))
    }
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(path.join(tmpDir, name), { readOnly: true })
    const rows = db!
      .prepare('SELECT id, created_at, updated_at, data_type, data, parent_id, folder_paths FROM threads')
      .all() as ZedThreadRow[]
    return collectEntries(rows, date)
  } finally {
    db?.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export async function readZedHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  const base = { id: ID, label: LABEL }
  const dbFile = path.join(homeDir, '.local', 'share', 'zed', 'threads', 'threads.db')
  try {
    if (!fs.existsSync(dbFile)) {
      return { ...base, available: false, error: `Không tìm thấy ${DB_DISPLAY}`, projects: [] }
    }
    if (typeof (zlib as { zstdDecompressSync?: unknown }).zstdDecompressSync !== 'function') {
      return { ...base, available: false, error: 'Cần Node.js hỗ trợ zstd (zlib.zstdDecompressSync) để đọc lịch sử Zed', projects: [] }
    }
    let entries: Entry[]
    try {
      entries = await readEntries(dbFile, date)
    } catch {
      try {
        // Lỗi đọc DB (ví dụ không có node:sqlite) không được làm hỏng toàn bộ hệ thống
        await import('node:sqlite')
      } catch {
        return { ...base, available: false, error: 'Cần Node.js >= 22.13 (node:sqlite) để đọc lịch sử Zed', projects: [] }
      }
      return { ...base, available: false, error: `Không đọc được ${DB_DISPLAY}`, projects: [] }
    }
    return { ...base, available: true, projects: groupPromptsByProject(date, entries) }
  } catch {
    return { ...base, available: false, error: `Không đọc được ${DB_DISPLAY}`, projects: [] }
  }
}
