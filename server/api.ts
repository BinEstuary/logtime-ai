// Backend API dùng chung cho Vite dev server và bản desktop (Electron).
// Mọi lệnh redmine được gọi bằng execFile (mảng tham số, không qua shell) để chạy được trên
// Linux/Windows/macOS và tránh lỗi chèn lệnh khi tiêu đề/ghi chú chứa ký tự đặc biệt.
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import type { IncomingMessage, ServerResponse } from 'http'
import { readAgentHistory, ALL_AGENT_SOURCES, type AgentSource } from './agentHistory'
import { activityDataDir, getActivityTracker } from './activityTracker'
import { installGnomeExtension } from './gnomeExtension'

export interface ApiOptions {
  /** Đường dẫn tới binary redmine CLI */
  redmineBin: string
  /** Thư mục ghi current_tasks.json */
  dataDir: string
  /** Bật đọc lịch sử AI agent và tự theo dõi hoạt động trên máy (mặc định tắt) */
  enableLocalActivity?: boolean
  /** Thư mục chứa extension GNOME đi kèm (gnome-extension/) */
  gnomeExtensionDir?: string
}

type Next = (err?: unknown) => void

const BIN_NAME = process.platform === 'win32' ? 'redmine.exe' : 'redmine'

/** Tìm redmine CLI: các thư mục ưu tiên → ~/.local/bin → PATH */
export function resolveRedmineBin(preferredDirs: string[] = []): string {
  const candidates = [
    process.env.REDMINE_BIN,
    ...preferredDirs.map((d) => path.join(d, BIN_NAME)),
    path.join(os.homedir(), '.local', 'bin', BIN_NAME),
  ].filter(Boolean) as string[]
  return candidates.find((p) => fs.existsSync(p)) || BIN_NAME
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

/** Lỗi do dữ liệu gửi lên — trả 400 thay vì 500 */
class BadRequest extends Error {}

const readBody = (req: IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {}
        // Body phải là object JSON (null, mảng, số... coi như rỗng)
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
      } catch {
        reject(new BadRequest('Body không phải JSON hợp lệ'))
      }
    })
    req.on('error', reject)
  })

const runRedmine = (bin: string, args: string[]) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })

// Lấy lý do lỗi thật từ redmine CLI (JSON trên stdout khi -o json, hoặc stderr) mà không lộ đường dẫn lệnh
const redmineError = (e: any) => {
  let message = ''
  let code = ''
  try {
    const parsed = JSON.parse(e.stdout || '')
    message = parsed?.error?.message || ''
    code = parsed?.error?.code || ''
  } catch {
    /* không phải JSON */
  }
  if (!message) message = String(e.stderr || '').replace(/^Error:\s*/, '').trim()
  if (!message) message = e.code === 'ENOENT' ? 'Không tìm thấy redmine CLI trên máy' : 'Lỗi khi gọi Redmine'
  // "resolving project: no match found ... Available projects: ..." → chỉ giữ ý chính, là lỗi do dữ liệu gửi lên
  const unknownProject = message.match(/no match found for "([^"]*)"/)
  if (unknownProject) return { status: 400, body: { success: false, error: `Không tìm thấy project "${unknownProject[1]}"` } }
  message = message.replace(/:\s*\n\s*-\s*/, ': ').replace(/\s*\n\s*-\s*/g, '; ').trim()
  const status = code === 'not_found' || /not found/i.test(message) ? 404 : code === 'validation_failed' || /^Validation error/i.test(message) ? 422 : 502
  return { status, body: { success: false, error: message, ...(code && { code }) } }
}

const sendRedmineError = (res: ServerResponse, e: unknown) => {
  const { status, body } = redmineError(e)
  return sendJson(res, status, body)
}

/** ID số nguyên dương viết bằng chữ số (từ chối "4abc", "-4", 4.9, [4]) */
const parsePositiveId = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  const s = String(value).trim()
  const n = Number(s)
  return /^\d{1,15}$/.test(s) && n > 0 && Number.isSafeInteger(n) ? n : undefined
}

/** Ngày YYYY-MM-DD có thật (từ chối 2026-13-45, 2026-02-30) */
const isValidDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const INVALID_DATE = 'Tham số date phải là ngày hợp lệ dạng YYYY-MM-DD'
const MAX_HOURS_PER_ENTRY = 24

const readRedmineConfig = (configPath: string) => {
  if (!fs.existsSync(configPath)) return { server: '', apiKey: '' }
  const content = fs.readFileSync(configPath, 'utf8')
  return {
    server: content.match(/server:\s*["']?([^"'\r\n]+)/)?.[1] || '',
    apiKey: content.match(/api_key:\s*["']?([^"'\r\n]+)/)?.[1] || '',
  }
}

const maskKey = (key: string) => (key ? `••••${key.slice(-4)}` : '')

const yamlQuote = (value: string) => `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// Ghi cấu hình MCP redmine cho Antigravity, giữ nguyên các MCP server khác đã có trong file
const updateMcpConfig = (file: string, redmineBin: string, server: string, apiKey: string) => {
  if (!fs.existsSync(path.dirname(file))) return
  let config: any = {}
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    config = {}
  }
  config.mcpServers = {
    ...(config.mcpServers || {}),
    redmine: {
      command: redmineBin,
      args: ['mcp', 'serve'],
      env: { REDMINE_SERVER: server, REDMINE_API_KEY: apiKey, REDMINE_MCP_ENABLE_WRITES: 'true' },
    },
  }
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
}

export function createApiMiddleware(options: ApiOptions) {
  const { redmineBin, dataDir } = options
  const tracker = options.enableLocalActivity ? getActivityTracker(activityDataDir()) : undefined
  const configPath = path.join(os.homedir(), '.redmine-cli.yaml')

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const route = `${req.method} ${url.pathname}`

    try {
      switch (route) {
        // 1. Đọc cấu hình Redmine hiện tại
        // Không bao giờ trả API key về giao diện: chỉ báo đã có khoá và 4 ký tự cuối để nhận diện
        case 'GET /api/get-redmine': {
          const { server, apiKey } = readRedmineConfig(configPath)
          return sendJson(res, 200, { success: true, server, hasApiKey: !!apiKey, apiKeyHint: maskKey(apiKey) })
        }

        // 2. Lưu cấu hình Redmine và cập nhật cấu hình MCP cho các agent
        case 'POST /api/save-redmine': {
          const data = await readBody(req)
          // Để trống API key nghĩa là giữ nguyên khoá đã lưu
          if (!data.apiKey) data.apiKey = readRedmineConfig(configPath).apiKey
          const yamlContent = `# redmine-cli configuration
default_profile: default
profiles:
  default:
    server: ${yamlQuote(data.server)}
    api_key: ${yamlQuote(data.apiKey)}`
          // File chứa API key: chỉ tài khoản hiện tại được đọc (chmod vì mode chỉ áp dụng khi tạo file mới)
          fs.writeFileSync(configPath, yamlContent, { encoding: 'utf8', mode: 0o600 })
          if (process.platform !== 'win32') fs.chmodSync(configPath, 0o600)
          for (const file of [
            path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json'),
            path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json'),
          ]) {
            updateMcpConfig(file, redmineBin, data.server, data.apiKey)
          }
          return sendJson(res, 200, { success: true, hasApiKey: !!data.apiKey, apiKeyHint: maskKey(data.apiKey) })
        }

        // 3. Đồng bộ task hiện tại ra file JSON (cầu nối cho AI trong chat)
        case 'POST /api/sync-workspace-tasks': {
          const data = await readBody(req)
          fs.mkdirSync(dataDir, { recursive: true })
          fs.writeFileSync(path.join(dataDir, 'current_tasks.json'), JSON.stringify(data, null, 2), 'utf8')
          return sendJson(res, 200, { success: true })
        }

        // Danh sách Activity của project chứa issue (Redmine bắt buộc có activity khi log time)
        case 'POST /api/redmine/time-activities': {
          const { issue } = await readBody(req)
          const issueId = parsePositiveId(issue)
          if (!issueId) return sendJson(res, 400, { success: false, error: 'Mã issue không hợp lệ' })
          try {
            const { stdout: issueJson } = await runRedmine(redmineBin, ['issues', 'get', String(issueId), '-o', 'json'])
            const projectId = parsePositiveId(JSON.parse(issueJson || '{}').project?.id)
            if (!projectId) return sendJson(res, 404, { success: false, error: `Không tìm thấy project của issue #${issueId}` })
            const { stdout } = await runRedmine(redmineBin, ['api', `/projects/${projectId}.json?include=time_entry_activities`, '-o', 'json'])
            const list = JSON.parse(stdout || '{}').project?.time_entry_activities
            return sendJson(res, 200, Array.isArray(list) ? list.map((a: any) => ({ id: a.id, name: a.name })) : [])
          } catch (e) {
            return sendRedmineError(res, e)
          }
        }

        // 4. Log time một task lên Redmine
        case 'POST /api/redmine/log': {
          const { hours, comment, date, issue, activity } = await readBody(req)
          if (!isValidDate(date)) return sendJson(res, 400, { success: false, error: INVALID_DATE })
          const [y, m, d] = date.split('-').map(Number)
          const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
          if (dayOfWeek === 0 || dayOfWeek === 6) {
            return sendJson(res, 400, { success: false, error: 'Không được phép log time vào Thứ Bảy và Chủ Nhật!' })
          }
          // Chỉ nhận số thập phân thường (từ chối "1e1", "0x2")
          const hoursNum = typeof hours === 'number' ? hours : typeof hours === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(hours) ? Number(hours) : NaN
          if (!Number.isFinite(hoursNum) || hoursNum <= 0 || hoursNum > MAX_HOURS_PER_ENTRY) {
            return sendJson(res, 400, { success: false, error: `Số giờ phải lớn hơn 0 và không quá ${MAX_HOURS_PER_ENTRY}` })
          }
          // Quy định: time entry phải nằm trong một task (issue) — không log trực tiếp vào project
          if (issue === undefined || issue === null || issue === '') {
            return sendJson(res, 400, { success: false, error: 'Phải log vào một task (issue), không log trực tiếp vào project!' })
          }
          const issueId = parsePositiveId(issue)
          if (!issueId) return sendJson(res, 400, { success: false, error: 'Mã issue không hợp lệ' })
          // Activity: tên hoặc ID; mặc định "Development" như Redmine đang dùng
          const activityRef = typeof activity === 'number' ? String(activity) : typeof activity === 'string' ? activity.trim() : 'Development'
          if (!activityRef || activityRef.length > 100) return sendJson(res, 400, { success: false, error: 'Activity không hợp lệ' })
          const args = ['time', 'log', '--hours', String(hoursNum), '--date', date, '--comment', String(comment ?? ''), '--issue', String(issueId), '--activity', activityRef, '-o', 'json']
          try {
            const { stdout: issueJson } = await runRedmine(redmineBin, ['issues', 'get', String(issueId), '--children', '-o', 'json'])
            const target = JSON.parse(issueJson || '{}')
            if (Array.isArray(target.children) && target.children.length > 0) {
              return sendJson(res, 400, { success: false, error: `Issue #${issueId} có task con, hãy log vào task con!` })
            }
            const { stdout } = await runRedmine(redmineBin, args)
            let entry: unknown
            try {
              entry = JSON.parse(stdout)
            } catch {
              entry = undefined
            }
            return sendJson(res, 200, { success: true, entry })
          } catch (e) {
            const { status, body } = redmineError(e)
            return sendJson(res, status, status === 404 ? { ...body, error: `Không tìm thấy issue #${issueId}` } : body)
          }
        }

        // 5. Tìm issue trên Redmine
        case 'POST /api/redmine/search': {
          const { query, assignee, status, limit, project, parent } = await readBody(req)
          const args = ['issues', 'list', '-o', 'json']
          if (query) args.push('--filter', `subject=~${query}`)
          if (assignee) args.push('--assignee', String(assignee))
          if (project) args.push('--project', String(project))
          if (parent !== undefined && parent !== null && parent !== '') {
            const parentId = parsePositiveId(parent)
            if (!parentId) return sendJson(res, 400, { success: false, error: 'Mã issue cha không hợp lệ' })
            args.push('--parent', String(parentId))
          }
          args.push('--status', status ? String(status) : '*')
          args.push('--limit', String(typeof limit === 'number' ? limit : 100))
          try {
            const { stdout } = await runRedmine(redmineBin, args)
            return sendJson(res, 200, stdout || '[]')
          } catch {
            // Trả mảng rỗng thay vì làm hỏng giao diện
            return sendJson(res, 200, [])
          }
        }

        // 5b. Danh sách project (có parent) để dựng cây project/subproject
        case 'GET /api/redmine/projects': {
          try {
            const { stdout } = await runRedmine(redmineBin, ['projects', 'list', '-o', 'json', '--limit', '0'])
            return sendJson(res, 200, stdout || '[]')
          } catch (e) {
            return sendRedmineError(res, e)
          }
        }

        // 5c. Chi tiết một issue kèm danh sách task con
        case 'GET /api/redmine/issue': {
          const id = parsePositiveId(url.searchParams.get('id'))
          if (!id) return sendJson(res, 400, { success: false, error: 'Tham số id phải là mã issue hợp lệ' })
          try {
            const { stdout } = await runRedmine(redmineBin, ['issues', 'get', String(id), '--children', '-o', 'json'])
            return sendJson(res, 200, stdout || '{}')
          } catch (e) {
            const { status, body } = redmineError(e)
            return sendJson(res, status, status === 404 ? { ...body, error: `Không tìm thấy issue #${id}` } : body)
          }
        }

        // 6. Tạo issue (subtask) trên Redmine
        case 'POST /api/redmine/create-issue': {
          const { project, parent, subject, description, estimatedHours, allowRoot } = await readBody(req)
          if (typeof subject !== 'string' || !subject.trim()) {
            return sendJson(res, 400, { success: false, error: 'Subject is required' })
          }
          const args = ['issues', 'create', '--subject', subject.trim(), '--assignee', 'me', '-o', 'json']
          let parentId: number | undefined
          if (parent !== undefined && parent !== null && parent !== '') {
            parentId = parsePositiveId(parent)
            if (!parentId) return sendJson(res, 400, { success: false, error: 'Mã issue cha không hợp lệ' })
            args.push('--parent', String(parentId))
          } else if (allowRoot !== true) {
            // Task do AI gợi ý phải là task con; chỉ task cha tạo thủ công mới được phép ở cấp gốc
            return sendJson(res, 400, { success: false, error: 'Task phải được tạo làm task con của một issue cha' })
          }
          let projectRef = project ? String(project) : ''
          // Task con mặc định nằm cùng project với issue cha
          if (!projectRef && parentId) {
            try {
              const { stdout } = await runRedmine(redmineBin, ['issues', 'get', String(parentId), '-o', 'json'])
              projectRef = String(JSON.parse(stdout || '{}').project?.id || '')
            } catch (e) {
              const { status, body } = redmineError(e)
              return sendJson(res, status, status === 404 ? { ...body, error: `Không tìm thấy issue cha #${parentId}` } : body)
            }
          }
          if (!projectRef) return sendJson(res, 400, { success: false, error: 'Cần chọn project (hoặc issue cha) để tạo issue' })
          args.push('--project', projectRef)
          if (description) args.push('--description', String(description))
          if (estimatedHours !== undefined && estimatedHours !== null && estimatedHours !== '') {
            const est = Number(estimatedHours)
            if (!Number.isFinite(est) || est < 0) return sendJson(res, 400, { success: false, error: 'Số giờ ước lượng không hợp lệ' })
            if (est > 0) args.push('--estimated-hours', String(est))
          }
          try {
            const { stdout } = await runRedmine(redmineBin, args)
            return sendJson(res, 200, stdout)
          } catch (e) {
            return sendRedmineError(res, e)
          }
        }

        // 7. Danh sách time entries (của tôi hoặc cả nhóm)
        case 'GET /api/redmine/time-entries':
        case 'POST /api/redmine/time-entries': {
          const userId = url.searchParams.get('user_id') || 'me'
          if (userId !== 'me' && userId !== 'all' && !parsePositiveId(userId)) {
            return sendJson(res, 400, { success: false, error: 'user_id phải là me, all hoặc mã người dùng' })
          }
          const limit = String(parsePositiveId(url.searchParams.get('limit')) || 150)
          const args = ['time', 'list', '-o', 'json', '--limit', limit]
          if (userId !== 'all') args.push('--user', userId)
          try {
            const { stdout } = await runRedmine(redmineBin, args)
            return sendJson(res, 200, stdout || '[]')
          } catch (e) {
            return sendRedmineError(res, e)
          }
        }

        // 8. Lịch sử AI agent trên máy — chỉ bật khi được cấu hình rõ ràng
        // 9. Hoạt động trên máy (tự theo dõi) theo ngày
        case 'GET /api/activity': {
          if (!tracker) return sendJson(res, 404, { success: false, error: 'Activity tracking is disabled' })
          const date = url.searchParams.get('date') || ''
          if (!isValidDate(date)) return sendJson(res, 400, { success: false, error: INVALID_DATE })
          return sendJson(res, 200, { success: true, ...tracker.summary(date) })
        }

        case 'POST /api/activity/tracking': {
          if (!tracker) return sendJson(res, 404, { success: false, error: 'Activity tracking is disabled' })
          const { enabled } = await readBody(req)
          if (typeof enabled !== 'boolean') return sendJson(res, 400, { success: false, error: 'enabled phải là true hoặc false' })
          tracker.setEnabled(enabled)
          return sendJson(res, 200, { success: true, tracking: tracker.enabled })
        }

        // Cài extension GNOME đọc cửa sổ đang dùng (GNOME Wayland)
        case 'POST /api/activity/gnome-extension': {
          if (!tracker || !options.gnomeExtensionDir || process.platform !== 'linux') {
            return sendJson(res, 404, { success: false, error: 'Không hỗ trợ trên môi trường này' })
          }
          const result = await installGnomeExtension(options.gnomeExtensionDir)
          return sendJson(res, 200, { success: true, ...result })
        }

        case 'GET /api/agent-history': {
          if (!options.enableLocalActivity) return sendJson(res, 404, { success: false, error: 'Agent history API is disabled' })
          const date = url.searchParams.get('date') || ''
          const sources = (url.searchParams.get('sources') || ALL_AGENT_SOURCES.join(','))
            .split(',')
            .filter((s): s is AgentSource => (ALL_AGENT_SOURCES as string[]).includes(s))
          if (!isValidDate(date)) return sendJson(res, 400, { success: false, error: INVALID_DATE })
          const result = await readAgentHistory(date, sources)
          return sendJson(res, 200, { success: true, ...result })
        }

        default:
          return next()
      }
    } catch (e: any) {
      if (e instanceof BadRequest) return sendJson(res, 400, { success: false, error: e.message })
      return sendJson(res, 500, { success: false, error: e.message })
    }
  }
}

/** Các proxy tới AI provider (tránh CORS từ trình duyệt) */
export const AI_PROXIES: Record<string, string> = {
  '/api-z': 'https://api.z.ai/api/paas/v4',
  '/api-groq': 'https://api.groq.com/openai/v1',
  '/api-gemini': 'https://generativelanguage.googleapis.com/v1beta/openai',
  '/api-openai': 'https://api.openai.com/v1',
  '/api-anthropic': 'https://api.anthropic.com/v1',
  '/api-openrouter': 'https://openrouter.ai/api/v1',
  '/api-deepseek': 'https://api.deepseek.com/v1',
  '/api-mistral': 'https://api.mistral.ai/v1',
}
