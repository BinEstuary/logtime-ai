// Đọc prompt người dùng đã gửi trong Cursor (Composer/Chat) cho một ngày, gom theo project.
// Dữ liệu nằm trong SQLite (state.vscdb) của VS Code: cursorDiskKV (composerData:*, bubbleId:*) ở bản global,
// và ItemTable (composer.composerData) ở mỗi workspaceStorage để biết composer thuộc thư mục nào.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { groupPromptsByProject, parseTime, type AgentSourceResult } from './common'

const ID = 'cursor'
const LABEL = 'Cursor'
const UNKNOWN_PROJECT = 'Không rõ thư mục'
const USER_BUBBLE_TYPE = 1

type Entry = { project: string; text: string; ts: number }

let sqliteLoader: Promise<any> | undefined
const loadDatabaseSync = () =>
  (sqliteLoader ??= import('node:sqlite')
    .then((m) => m.DatabaseSync)
    .catch(() => undefined))

const unavailable = (error: string): AgentSourceResult => ({ id: ID, label: LABEL, available: false, error, projects: [] })

/** Chạy fn trên bản sao tạm của DB (read-only) để không tranh khoá với Cursor đang mở */
async function withDbCopy<T>(dbPath: string, fn: (db: any) => T): Promise<T> {
  const DatabaseSync = await loadDatabaseSync()
  if (!DatabaseSync) throw new Error('Cần Node.js >= 22.13 (node:sqlite)')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logtime-cursor-'))
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const src = dbPath + suffix
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, 'state.vscdb' + suffix))
    }
    const db = new DatabaseSync(path.join(tmpDir, 'state.vscdb'), { readOnly: true })
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

const parseJson = (value: unknown): any => {
  if (value == null) return undefined
  const text = typeof value === 'string' ? value : Buffer.from(value as Uint8Array).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Đọc thư mục gốc của một workspaceStorage từ workspace.json (folder hoặc workspace cho .code-workspace) */
function readWorkspaceFolder(wsDir: string): string | undefined {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(wsDir, 'workspace.json'), 'utf8'))
    const uri: unknown = meta.folder ?? meta.workspace
    if (typeof uri !== 'string' || !uri.startsWith('file://')) return undefined
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

/** Danh sách composerId đang nằm trong một workspace (ItemTable.composer.composerData.allComposers) */
function readWorkspaceComposerIds(db: any): string[] {
  const row = db.prepare('select value from ItemTable where key = ?').get('composer.composerData')
  const data = parseJson(row?.value)
  const composers: any[] = Array.isArray(data?.allComposers) ? data.allComposers : []
  return composers.map((c) => c?.composerId).filter((id): id is string => typeof id === 'string')
}

/** Bubble loại user có text và createdAt (ISO); bản cũ có thể nằm trong composerData.conversationMap */
function collectUserPrompts(
  rows: { key: string; value: unknown }[],
  composerProject: Map<string, string>
): Entry[] {
  const entries: Entry[] = []
  const pushBubble = (composerId: string, bubble: any) => {
    if (bubble?.type !== USER_BUBBLE_TYPE || typeof bubble.text !== 'string') return
    const ts = parseTime(bubble.createdAt)
    if (!ts) return
    entries.push({ project: composerProject.get(composerId) ?? UNKNOWN_PROJECT, text: bubble.text, ts })
  }

  for (const row of rows) {
    const parts = row.key.split(':')
    try {
      if (row.key.startsWith('bubbleId:')) {
        pushBubble(parts[1], parseJson(row.value))
      } else if (row.key.startsWith('composerData:')) {
        const composer = parseJson(row.value)
        const map = composer?.conversationMap && typeof composer.conversationMap === 'object' ? composer.conversationMap : {}
        for (const bubble of Object.values(map)) pushBubble(parts[1], bubble)
      }
    } catch {
      // Bỏ qua một dòng hỏng, tiếp tục các dòng khác
    }
  }
  return entries
}

export async function readCursorHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  try {
    const userDir = path.join(homeDir, '.config', 'Cursor', 'User')
    const globalDb = path.join(userDir, 'globalStorage', 'state.vscdb')
    if (!fs.existsSync(globalDb)) {
      return unavailable('Không tìm thấy ~/.config/Cursor/User/globalStorage/state.vscdb')
    }
    if (!(await loadDatabaseSync())) return unavailable('Cần Node.js >= 22.13 (node:sqlite) để đọc lịch sử Cursor')

    // composerId -> thư mục workspace chứa composer đó
    const composerProject = new Map<string, string>()
    const wsRoot = path.join(userDir, 'workspaceStorage')
    if (fs.existsSync(wsRoot)) {
      for (const name of fs.readdirSync(wsRoot)) {
        const wsDir = path.join(wsRoot, name)
        const wsDb = path.join(wsDir, 'state.vscdb')
        if (!fs.existsSync(wsDb)) continue
        try {
          const folder = readWorkspaceFolder(wsDir) ?? UNKNOWN_PROJECT
          const ids = await withDbCopy(wsDb, readWorkspaceComposerIds)
          for (const id of ids) composerProject.set(id, folder)
        } catch {
          // Workspace hỏng hoặc đang khoá: bỏ qua
        }
      }
    }

    const rows = await withDbCopy(globalDb, (db) =>
      db
        .prepare("select key, value from cursorDiskKV where key like 'bubbleId:%' or key like 'composerData:%'")
        .all() as { key: string; value: unknown }[]
    )
    const entries = collectUserPrompts(rows, composerProject)

    return { id: ID, label: LABEL, available: true, projects: groupPromptsByProject(date, entries) }
  } catch {
    return unavailable('Không đọc được lịch sử Cursor (state.vscdb)')
  }
}
