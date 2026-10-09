// Tiến trình chính của bản desktop: chạy một HTTP server nội bộ (chỉ 127.0.0.1) phục vụ giao diện đã build,
// API redmine và proxy AI — giống hệt môi trường Vite dev nên frontend không cần sửa gì.
import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { AI_PROXIES, createApiMiddleware, resolveRedmineBin } from '../server/api'

// Cổng cố định để origin (và localStorage chứa dữ liệu task) không đổi giữa các lần mở app
const PREFERRED_PORT = 47821
const HOST = '127.0.0.1'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const webRoot = () => path.join(app.getAppPath(), 'dist')

// Binary redmine đi kèm app nằm trong resources/bin khi đã đóng gói
const bundledBinDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'build', 'bin', `${process.platform}-${process.arch}`)

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const root = webRoot()
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
  let file = path.normalize(path.join(root, pathname))
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, 'index.html') // SPA fallback
  }
  res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

async function proxyToAi(req: http.IncomingMessage, res: http.ServerResponse, prefix: string, target: string) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' && !['host', 'origin', 'referer', 'connection', 'content-length'].includes(key)) {
      headers[key] = value
    }
  }

  try {
    const upstream = await fetch(target + (req.url || '').slice(prefix.length), {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    })
    const responseHeaders: Record<string, string> = {}
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) responseHeaders[key] = value
    })
    res.writeHead(upstream.status, responseHeaders)
    if (upstream.body) {
      for await (const chunk of upstream.body as any) res.write(chunk)
    }
    res.end()
  } catch (e: any) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: `Không kết nối được AI provider: ${e.message}` } }))
  }
}

function startServer(): Promise<number> {
  const api = createApiMiddleware({
    redmineBin: resolveRedmineBin([bundledBinDir()]),
    dataDir: app.getPath('userData'),
    // App desktop chạy trên chính máy người dùng nên mặc định bật; đặt ENABLE_AGENT_HISTORY=0 để tắt
    enableLocalActivity: process.env.ENABLE_AGENT_HISTORY !== '0',
    gnomeExtensionDir: app.isPackaged
      ? path.join(process.resourcesPath, 'gnome-extension')
      : path.join(app.getAppPath(), 'gnome-extension'),
  })

  const server = http.createServer((req, res) => {
    const url = req.url || '/'
    const proxy = Object.entries(AI_PROXIES).find(([prefix]) => url === prefix || url.startsWith(prefix + '/'))
    if (proxy) return void proxyToAi(req, res, proxy[0], proxy[1])
    if (url.startsWith('/api/')) return void api(req, res, () => serveStatic(req, res))
    serveStatic(req, res)
  })

  return new Promise((resolve, reject) => {
    const listen = (port: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        // Cổng ưu tiên đang bận → dùng cổng ngẫu nhiên (dữ liệu localStorage sẽ tách riêng cho phiên này)
        if (err.code === 'EADDRINUSE' && port !== 0) listen(0)
        else reject(err)
      })
      server.listen(port, HOST, () => resolve((server.address() as { port: number }).port))
    }
    listen(PREFERRED_PORT)
  })
}

function createWindow(port: number) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'LogTime AI',
    backgroundColor: '#141413',
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  })

  const appOrigin = `http://${HOST}:${port}`
  // Link ngoài (Redmine, ...) mở bằng trình duyệt mặc định thay vì trong cửa sổ app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(appOrigin)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  void win.loadURL(appOrigin)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    try {
      const port = await startServer()
      createWindow(port)
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(port)
      })
    } catch (e: any) {
      dialog.showErrorBox('LogTime AI', `Không khởi động được server nội bộ: ${e.message}`)
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
