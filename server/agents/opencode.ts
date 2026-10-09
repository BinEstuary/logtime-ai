import fs from 'fs'
import path from 'path'
import os from 'os'
import { VN_OFFSET_MS, groupPromptsByProject, type AgentSourceResult } from './common'

const LABEL = 'opencode'
const DAY_MS = 24 * 60 * 60 * 1000

export async function readOpenCodeHistory(date: string, homeDir: string): Promise<AgentSourceResult> {
  const dbFile = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db')
  const result = (partial: Partial<AgentSourceResult>): AgentSourceResult => ({
    id: 'opencode',
    label: LABEL,
    available: true,
    projects: [],
    ...partial,
  })

  if (!fs.existsSync(dbFile)) {
    return result({ available: false, error: 'Không tìm thấy ~/.local/share/opencode/opencode.db' })
  }

  let DatabaseSync: any
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return result({ available: false, error: 'Cần Node.js >= 22.13 (node:sqlite) để đọc lịch sử opencode' })
  }

  // Copy ra thư mục tạm để không tranh khoá với opencode đang chạy
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logtime-opencode-'))
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const src = dbFile + suffix
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmpDir, 'db' + suffix))
    }

    // time_created là mili-giây; nới cửa sổ 1 ngày mỗi phía, lọc chính xác ở groupPromptsByProject
    const dayStartMs = Date.parse(`${date}T00:00:00Z`) - VN_OFFSET_MS
    const lo = dayStartMs - DAY_MS
    const hi = dayStartMs + 2 * DAY_MS

    const db = new DatabaseSync(path.join(tmpDir, 'db'), { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT p.data AS part_data, m.time_created AS ts, s.directory AS directory, pr.worktree AS worktree
             FROM part p
             JOIN message m ON m.id = p.message_id
             JOIN session s ON s.id = p.session_id
             LEFT JOIN project pr ON pr.id = s.project_id
            WHERE m.time_created BETWEEN ? AND ?
              AND json_extract(m.data, '$.role') = 'user'
              AND json_extract(p.data, '$.type') = 'text'`
        )
        .all(lo, hi)

      const entries: { project: string; text: string; ts: number }[] = []
      for (const row of rows) {
        try {
          const part = JSON.parse(String(row.part_data))
          // synthetic/ignored là text do opencode tự sinh (nhắc việc, tóm tắt), không phải người dùng nhập
          if (part.synthetic || part.ignored) continue
          if (typeof part.text !== 'string' || !part.text.trim()) continue

          // worktree '/' là project chung (phiên không thuộc git repo) nên dùng thư mục của phiên
          const worktree = typeof row.worktree === 'string' ? row.worktree.trim() : ''
          const directory = typeof row.directory === 'string' ? row.directory.trim() : ''
          const project = (worktree && worktree !== '/' ? worktree : directory) || '(không rõ thư mục)'

          entries.push({ project, text: part.text, ts: Number(row.ts) || 0 })
        } catch {
          // Bỏ qua dòng lỗi
        }
      }

      return result({ projects: groupPromptsByProject(date, entries) })
    } finally {
      db.close()
    }
  } catch (e: any) {
    return result({ available: false, error: `Không đọc được opencode: ${e?.message ?? 'lỗi không xác định'}` })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
