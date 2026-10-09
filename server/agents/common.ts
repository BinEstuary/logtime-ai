// Tiện ích dùng chung cho các bộ đọc lịch sử AI agent: múi giờ Việt Nam, che secret, ước lượng thời gian làm việc.
export const VN_OFFSET_MS = 7 * 60 * 60 * 1000
export const MAX_PROMPT_CHARS = 220
export const MAX_PROMPTS_PER_PROJECT = 25
// Khoảng lặng tối đa giữa 2 prompt vẫn được tính là đang làm việc liên tục
const MAX_ACTIVE_GAP_MIN = 30
const TAIL_AFTER_LAST_PROMPT_MIN = 10

/** Kết quả chuẩn của một nguồn (agent) cho một ngày */
export interface AgentProjectActivity {
  project: string
  name: string
  prompts: string[]
  promptCount: number
  firstAt: string
  lastAt: string
  estimatedMinutes: number
}

export interface AgentSourceResult {
  /** Mã nguồn ổn định, ví dụ 'codex', 'gemini-cli' */
  id: string
  /** Tên hiển thị, ví dụ 'Codex CLI' */
  label: string
  available: boolean
  error?: string
  projects: AgentProjectActivity[]
}

export const toVnDate = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10)
export const toVnTime = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(11, 16)

/** Parse thời gian từ chuỗi ISO hoặc số ms; trả 0 nếu không đọc được */
export const parseTime = (value: unknown): number => {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  if (typeof value !== 'string' || !value) return 0
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

// Che các chuỗi trông giống secret trước khi gửi nội dung đi tóm tắt
export const redact = (text: string) =>
  text
    .replace(/\b(sk|gsk|ghp|gho|xox[abp]|AKIA)[-_A-Za-z0-9]{12,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|passwd|secret)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}\b/g, '[REDACTED]')

export const clip = (text: string, max: number) => {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine
}

/** Lệnh điều khiển (/clear, /model...) không phản ánh công việc */
export const isControlCommand = (text: string) => /^\/[\w:-]+(\s+\S+)?$/.test(text.trim())

export const estimateActiveMinutes = (timestamps: number[]) => {
  if (timestamps.length === 0) return 0
  const sorted = [...timestamps].sort((a, b) => a - b)
  let minutes = TAIL_AFTER_LAST_PROMPT_MIN
  for (let i = 1; i < sorted.length; i++) {
    minutes += Math.min((sorted[i] - sorted[i - 1]) / 60000, MAX_ACTIVE_GAP_MIN)
  }
  return Math.round(minutes)
}

/**
 * Gom các prompt (đã có mốc thời gian, tên project) theo project của một ngày.
 * Mỗi bộ đọc chỉ cần đưa ra danh sách { project, text, ts } rồi gọi hàm này.
 */
export const groupPromptsByProject = (
  date: string,
  entries: { project: string; text: string; ts: number }[]
): AgentProjectActivity[] => {
  const byProject = new Map<string, { prompts: string[]; times: number[] }>()
  for (const e of entries) {
    if (!e.ts || toVnDate(e.ts) !== date) continue
    const text = e.text.trim()
    if (!text || isControlCommand(text)) continue
    const bucket = byProject.get(e.project) || { prompts: [], times: [] }
    bucket.prompts.push(clip(redact(text), MAX_PROMPT_CHARS))
    bucket.times.push(e.ts)
    byProject.set(e.project, bucket)
  }
  const projects = [...byProject.entries()].map(([project, { prompts, times }]) => ({
    project,
    name: project.split(/[\\/]/).filter(Boolean).pop() || project,
    prompts: prompts.slice(0, MAX_PROMPTS_PER_PROJECT),
    promptCount: prompts.length,
    firstAt: toVnTime(Math.min(...times)),
    lastAt: toVnTime(Math.max(...times)),
    estimatedMinutes: estimateActiveMinutes(times),
  }))
  return projects.sort((a, b) => b.estimatedMinutes - a.estimatedMinutes)
}
