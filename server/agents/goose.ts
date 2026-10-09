import fs from 'fs'
import path from 'path'
import os from 'os'
import { VN_OFFSET_MS, groupPromptsByProject, type AgentSourceResult } from './common'

const LABEL = 'Goose'
const DAY_MS = 24 * 60 * 60 * 1000

/** Lấy text của các phần tử { type: 'text', text } trong content_json */
function messageText(contentJson: string): string {
  try {
    const parts = JSON.parse(contentJson)
    if (!Array.isArray(parts)) return ''
    return parts
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n')
  } catch {
    return ''
  }
}

export async function readGooseHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  const dbFile = path.join(homeDir, '.local', 'share', 'goose', 'sessions', 'sessions.db')
  const result = (partial: Partial<AgentSourceResult>): AgentSourceResult => ({
    id: 'goose',
    label: LABEL,
    available: true,
    projects: [],
    ...partial,
  })

  if (!fs.existsSync(dbFile)) {
    return result({ available: false, error: 'Không tìm thấy ~/.local/share/goose/sessions/sessions.db' })
  }

  let DatabaseSync: any
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return result({ available: false, error: 'Cần Node.js >= 22.13 (node:sqlite) để đọc lịch sử Goose' })
  }

  // Copy ra thư mục tạm để không tranh khoá với Goose đang chạy
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logtime-goose-'))
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const src = dbFile + suffix
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, 'db' + suffix))
    }

    // created_timestamp là giây theo Unix; cửa sổ thời gian nới rộng 1 ngày mỗi phía, lọc chính xác ở groupPromptsByProject
    const dayStartMs = Date.parse(`${date}T00:00:00Z`) - VN_OFFSET_MS
    const lo = (dayStartMs - DAY_MS) / 1000
    const hi = (dayStartMs + 2 * DAY_MS) / 1000

    const db = new DatabaseSync(path.join(tmpDir, 'db'), { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT m.content_json, m.metadata_json, m.created_timestamp, s.working_dir
             FROM messages m
             JOIN sessions s ON s.id = m.session_id
            WHERE m.role = 'user'
              AND ((m.created_timestamp BETWEEN ? AND ?) OR (m.created_timestamp BETWEEN ? AND ?))`
        )
        .all(lo, hi, lo * 1000, hi * 1000)

      const entries: { project: string; text: string; ts: number }[] = []
      for (const row of rows) {
        try {
          // userVisible = false là tin nhắn hệ thống, không phải người dùng nhập
          const meta = row.metadata_json ? JSON.parse(row.metadata_json) : {}
          if (meta?.userVisible === false) continue
          const text = messageText(String(row.content_json || ''))
          if (!text.trim()) continue
          const raw = Number(row.created_timestamp) || 0
          const ts = raw < 1e12 ? raw * 1000 : raw
          const project = String(row.working_dir || '').trim() || '(không rõ thư mục)'
          entries.push({ project, text, ts })
        } catch {
          // Bỏ qua dòng lỗi
        }
      }

      return result({ projects: groupPromptsByProject(date, entries) })
    } finally {
      db.close()
    }
  } catch (e: any) {
    return result({ available: false, error: `Không đọc được Goose: ${e?.message ?? 'lỗi không xác định'}` })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
