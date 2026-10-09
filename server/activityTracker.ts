// Tự theo dõi hoạt động trên máy (giống ActivityWatch): lấy mẫu thời gian rảnh, khoá màn hình và cửa sổ đang dùng
// mỗi 15 giây, gộp thành các sự kiện liên tục và lưu theo ngày vào <dataDir>/activity/YYYY-MM-DD.json.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { redact } from './agentHistory'
import { isGnomeExtensionInstalled, queryFocusedWindow } from './gnomeExtension'

const SAMPLE_INTERVAL_MS = 15_000
const FLUSH_INTERVAL_MS = 60_000
const AFK_THRESHOLD_MS = 3 * 60_000
// Hai mẫu cách nhau quá khoảng này (máy ngủ, app tắt) thì không nối thành một sự kiện
const MAX_MERGE_GAP_MS = SAMPLE_INTERVAL_MS * 2
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
const MAX_TITLE_CHARS = 160

export interface ActivityEvent {
  start: number
  end: number
  afk: boolean
  app?: string
  title?: string
}

export interface ActivityCapabilities {
  idle: boolean
  window: boolean
  hint?: string
  /** GNOME Wayland: trạng thái extension đọc cửa sổ của LogTime AI */
  gnomeExtension?: 'missing' | 'pending-relogin'
}

interface Sample {
  idleMs?: number
  locked?: boolean
  app?: string
  title?: string
}

const toVnDate = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10)
const toVnTime = (ms: number) => new Date(ms + VN_OFFSET_MS).toISOString().slice(11, 16)

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })

const gdbus = (dest: string, objectPath: string, method: string, ...args: string[]) =>
  run('gdbus', ['call', '--session', '--dest', dest, '--object-path', objectPath, '--method', method, ...args])

// Kết quả gdbus dạng "('chuỗi JSON',)" hoặc "(uint64 128,)"
const unwrapGdbusString = (out: string) => {
  const m = out.trim().match(/^\('([\s\S]*)',\)$/)
  return m ? m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\') : ''
}

// ---- Bộ đọc tín hiệu theo hệ điều hành ----

async function sampleLinux(): Promise<{ sample: Sample; caps: ActivityCapabilities }> {
  const sample: Sample = {}
  const caps: ActivityCapabilities = { idle: false, window: false }

  try {
    const out = await gdbus('org.gnome.Mutter.IdleMonitor', '/org/gnome/Mutter/IdleMonitor/Core', 'org.gnome.Mutter.IdleMonitor.GetIdletime')
    const m = out.match(/(\d+)/)
    if (m) {
      sample.idleMs = Number(m[1])
      caps.idle = true
    }
  } catch {
    /* không phải GNOME */
  }
  try {
    const out = await gdbus('org.gnome.ScreenSaver', '/org/gnome/ScreenSaver', 'org.gnome.ScreenSaver.GetActive')
    sample.locked = out.includes('true')
  } catch {
    /* bỏ qua */
  }

  // Cửa sổ đang dùng trên GNOME Wayland: ưu tiên extension của LogTime AI, sau đó tới "Window Calls" nếu đã cài
  try {
    const focused = JSON.parse(unwrapGdbusString(await queryFocusedWindow()) || '{}')
    caps.window = true
    sample.app = focused.wm_class || undefined
    sample.title = focused.title || undefined
  } catch {
    /* extension chưa cài hoặc chưa chạy */
  }
  if (!caps.window) {
    try {
      const list = JSON.parse(
        unwrapGdbusString(await gdbus('org.gnome.Shell', '/org/gnome/Shell/Extensions/Windows', 'org.gnome.Shell.Extensions.Windows.List'))
      )
      const focused = Array.isArray(list) ? list.find((w: any) => w.focus) : undefined
      caps.window = true
      if (focused) {
        sample.app = focused.wm_class || focused.wm_class_instance
        sample.title = focused.title
        if (!sample.title && focused.id !== undefined) {
          sample.title = unwrapGdbusString(
            await gdbus('org.gnome.Shell', '/org/gnome/Shell/Extensions/Windows', 'org.gnome.Shell.Extensions.Windows.GetTitle', String(focused.id))
          )
        }
      }
    } catch {
      // X11: đọc trực tiếp bằng xprop
      if (process.env.XDG_SESSION_TYPE === 'x11') {
        try {
          const active = (await run('xprop', ['-root', '_NET_ACTIVE_WINDOW'])).match(/(0x[0-9a-f]+)/i)?.[1]
          if (active && active !== '0x0') {
            const props = await run('xprop', ['-id', active, 'WM_CLASS', '_NET_WM_NAME'])
            sample.app = props.match(/WM_CLASS\(STRING\) = "[^"]*", "([^"]*)"/)?.[1]
            sample.title = props.match(/_NET_WM_NAME\(UTF8_STRING\) = "(.*)"/)?.[1]
            caps.window = true
          }
        } catch {
          /* bỏ qua */
        }
      }
    }
  }

  if (!caps.window) {
    if (process.env.XDG_SESSION_TYPE === 'wayland' && caps.idle) {
      caps.gnomeExtension = isGnomeExtensionInstalled() ? 'pending-relogin' : 'missing'
      caps.hint =
        caps.gnomeExtension === 'missing'
          ? 'GNOME Wayland không cho app đọc cửa sổ đang dùng. Cài extension LogTime AI để ghi nhận app/cửa sổ.'
          : 'Đã cài extension LogTime AI. Đăng xuất rồi đăng nhập lại để GNOME bật extension.'
    } else {
      caps.hint = 'Không đọc được cửa sổ đang dùng trên môi trường này.'
    }
  }
  if (!caps.idle) caps.hint = (caps.hint ? caps.hint + ' ' : '') + 'Không đọc được thời gian rảnh (chỉ hỗ trợ GNOME).'
  return { sample, caps }
}

async function sampleMac(): Promise<{ sample: Sample; caps: ActivityCapabilities }> {
  const sample: Sample = {}
  const caps: ActivityCapabilities = { idle: false, window: false }
  try {
    const m = (await run('ioreg', ['-c', 'IOHIDSystem'])).match(/"HIDIdleTime" = (\d+)/)
    if (m) {
      sample.idleMs = Math.round(Number(m[1]) / 1e6)
      caps.idle = true
    }
  } catch {
    /* bỏ qua */
  }
  try {
    const out = await run('osascript', [
      '-e',
      'tell application "System Events" to set p to first application process whose frontmost is true',
      '-e',
      'set t to ""',
      '-e',
      'try\nset t to name of front window of p\nend try',
      '-e',
      'return (name of p) & "\n" & t',
    ])
    const [app, title] = out.trim().split('\n')
    sample.app = app
    sample.title = title
    caps.window = true
  } catch {
    caps.hint = 'Cần cấp quyền Accessibility cho app để đọc cửa sổ đang dùng.'
  }
  return { sample, caps }
}

async function takeSample(): Promise<{ sample: Sample; caps: ActivityCapabilities }> {
  if (process.platform === 'linux') return sampleLinux()
  if (process.platform === 'darwin') return sampleMac()
  return { sample: {}, caps: { idle: false, window: false, hint: 'Chưa hỗ trợ theo dõi hoạt động trên hệ điều hành này.' } }
}

// ---- Tracker ----

/** Thư mục dữ liệu hoạt động dùng chung cho app, dev server và daemon chạy ngầm */
export function activityDataDir(): string {
  return process.env.ACTIVITY_DATA_DIR || path.join(os.homedir(), '.logtime-ai')
}

const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e.code === 'EPERM'
  }
}

export class ActivityTracker {
  private dir: string
  private lockFile: string
  private events: ActivityEvent[] = []
  private day = ''
  private dirty = false
  private timers: NodeJS.Timeout[] = []
  private lastSampleAt = 0
  /** Chỉ một tiến trình được ghi dữ liệu tại một thời điểm (daemon ưu tiên hơn app) */
  private writer = false
  private force: boolean
  capabilities: ActivityCapabilities = { idle: false, window: false }
  enabled = true

  constructor(dataDir: string, options: { force?: boolean } = {}) {
    this.dir = path.join(dataDir, 'activity')
    this.lockFile = path.join(this.dir, 'tracker.pid')
    this.force = !!options.force
    fs.mkdirSync(this.dir, { recursive: true })
    try {
      this.enabled = JSON.parse(fs.readFileSync(path.join(this.dir, 'config.json'), 'utf8')).enabled !== false
    } catch {
      this.enabled = true
    }
  }

  private lockOwner(): number {
    try {
      return Number(fs.readFileSync(this.lockFile, 'utf8')) || 0
    } catch {
      return 0
    }
  }

  /** Nhận quyền ghi nếu không có tiến trình khác đang giữ (daemon dùng force để giành lại quyền) */
  private claimWriter(force = this.force) {
    const owner = this.lockOwner()
    if (!force && owner && owner !== process.pid && pidAlive(owner)) {
      this.writer = false
      return
    }
    fs.writeFileSync(this.lockFile, String(process.pid), 'utf8')
    this.writer = true
    // Lấy lại đúng dữ liệu đã ghi của ngày hiện tại để không mất khi chuyển quyền
    this.day = ''
  }

  private releaseWriter() {
    if (this.writer && this.lockOwner() === process.pid) {
      try {
        fs.unlinkSync(this.lockFile)
      } catch {
        /* đã bị xoá */
      }
    }
    this.writer = false
  }

  get isWriter() {
    return this.writer
  }

  start() {
    this.claimWriter()
    void this.tick()
    this.timers.push(setInterval(() => void this.tick(), SAMPLE_INTERVAL_MS))
    this.timers.push(setInterval(() => this.flush(), FLUSH_INTERVAL_MS))
    for (const t of this.timers) t.unref?.()
    process.once('exit', () => {
      this.flush()
      this.releaseWriter()
    })
  }

  /** Dừng lấy mẫu, ghi nốt dữ liệu và trả quyền ghi (dùng khi daemon thoát) */
  stop() {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.flush()
    this.releaseWriter()
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    fs.writeFileSync(path.join(this.dir, 'config.json'), JSON.stringify({ enabled }), 'utf8')
    if (!enabled) this.flush()
  }

  private fileFor(date: string) {
    return path.join(this.dir, `${date}.json`)
  }

  private loadDay(date: string): ActivityEvent[] {
    try {
      const data = JSON.parse(fs.readFileSync(this.fileFor(date), 'utf8'))
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  private flush() {
    if (!this.writer || !this.dirty || !this.day) return
    fs.writeFileSync(this.fileFor(this.day), JSON.stringify(this.events), 'utf8')
    this.dirty = false
  }

  private async tick() {
    const now = Date.now()
    const { sample, caps } = await takeSample().catch(() => ({ sample: {} as Sample, caps: this.capabilities }))
    this.capabilities = caps
    if (!this.writer) {
      // Tiến trình khác đang ghi: chỉ thử nhận quyền khi chủ cũ đã thoát
      this.claimWriter(false)
      if (!this.writer) return
    } else if (this.lockOwner() !== process.pid) {
      // Daemon vừa giành quyền ghi: dừng ghi, bỏ dữ liệu trong bộ nhớ (đã có trong file của daemon)
      this.writer = false
      this.events = []
      this.dirty = false
      this.day = ''
      return
    }
    if (!this.enabled) return

    const date = toVnDate(now)
    if (date !== this.day) {
      this.flush()
      this.day = date
      this.events = this.loadDay(date)
    }

    const afk = !!sample.locked || (sample.idleMs ?? 0) > AFK_THRESHOLD_MS
    const app = afk ? undefined : sample.app || undefined
    const title = afk || !sample.title ? undefined : redact(sample.title).slice(0, MAX_TITLE_CHARS)
    const last = this.events[this.events.length - 1]
    const contiguous = last && now - last.end <= MAX_MERGE_GAP_MS && now - this.lastSampleAt <= MAX_MERGE_GAP_MS

    if (contiguous && last.afk === afk && last.app === app && last.title === title) {
      last.end = now
    } else {
      // Nối liền với sự kiện trước để timeline không bị hở giữa hai mẫu
      let start = contiguous ? last.end : now
      // Vừa chuyển sang AFK: khoảng rảnh trước đó cũng là AFK nên cắt bớt sự kiện đang dùng máy
      if (afk && contiguous && !last.afk && sample.idleMs) {
        start = Math.max(last.start, now - sample.idleMs)
        last.end = start
        if (last.end <= last.start) this.events.pop()
      }
      this.events.push({ start, end: now, afk, ...(app && { app }), ...(title && { title }) })
    }
    this.lastSampleAt = now
    this.dirty = true
  }

  summary(date: string) {
    const live = this.writer && date === this.day
    if (live) this.flush()
    const events = live ? this.events : this.loadDay(date)
    const minutes = (e: ActivityEvent) => (e.end - e.start) / 60000

    const active = events.filter((e) => !e.afk)
    const activeMinutes = Math.round(active.reduce((s, e) => s + minutes(e), 0))
    const afkMinutes = Math.round(events.filter((e) => e.afk).reduce((s, e) => s + minutes(e), 0))

    // Timeline: gộp các sự kiện liền nhau cùng trạng thái
    const timeline: { start: string; end: string; afk: boolean; startMs: number; endMs: number }[] = []
    for (const e of events) {
      const prev = timeline[timeline.length - 1]
      if (prev && prev.afk === e.afk && e.start - prev.endMs <= MAX_MERGE_GAP_MS) {
        prev.endMs = e.end
        prev.end = toVnTime(e.end)
      } else {
        timeline.push({ start: toVnTime(e.start), end: toVnTime(e.end), afk: e.afk, startMs: e.start, endMs: e.end })
      }
    }

    const byApp = new Map<string, { minutes: number; titles: Map<string, number> }>()
    for (const e of active) {
      if (!e.app) continue
      const bucket = byApp.get(e.app) || { minutes: 0, titles: new Map<string, number>() }
      bucket.minutes += minutes(e)
      if (e.title) bucket.titles.set(e.title, (bucket.titles.get(e.title) || 0) + minutes(e))
      byApp.set(e.app, bucket)
    }
    const apps = [...byApp.entries()]
      .map(([app, b]) => ({
        app,
        minutes: Math.round(b.minutes),
        titles: [...b.titles.entries()]
          .sort((a, b2) => b2[1] - a[1])
          .slice(0, 8)
          .map(([title, m]) => ({ title, minutes: Math.round(m) })),
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)

    return {
      date,
      tracking: this.enabled,
      capabilities: this.capabilities,
      activeMinutes,
      afkMinutes,
      firstActive: active.length ? toVnTime(active[0].start) : undefined,
      lastActive: active.length ? toVnTime(active[active.length - 1].end) : undefined,
      timeline,
      apps,
    }
  }
}

// Một tracker cho mỗi thư mục dữ liệu (Vite có thể gọi configureServer nhiều lần khi restart)
const trackers = new Map<string, ActivityTracker>()

export function getActivityTracker(dataDir: string): ActivityTracker {
  let tracker = trackers.get(dataDir)
  if (!tracker) {
    tracker = new ActivityTracker(dataDir)
    tracker.start()
    trackers.set(dataDir, tracker)
  }
  return tracker
}

/** Daemon chạy ngầm: luôn giành quyền ghi và giữ tiến trình sống cho tới khi nhận tín hiệu dừng */
export function runActivityDaemon(dataDir: string) {
  const tracker = new ActivityTracker(dataDir, { force: true })
  tracker.start()
  // Timer của tracker được unref để app thoát bình thường; daemon cần một timer giữ tiến trình sống
  const keepAlive = setInterval(() => undefined, 1 << 30)
  const shutdown = () => {
    clearInterval(keepAlive)
    tracker.stop()
    process.exit(0)
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  return tracker
}
