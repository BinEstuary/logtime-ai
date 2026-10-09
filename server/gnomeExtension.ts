// Cài extension GNOME "logtime-window@estuary.solutions" (thư mục gnome-extension/) cho người dùng hiện tại.
// Extension xuất method D-Bus trả về cửa sổ đang focus — GNOME Wayland không cho app thường đọc thông tin này.
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'

export const GNOME_EXTENSION_UUID = 'logtime-window@estuary.solutions'
export const GNOME_EXTENSION_DBUS = {
  dest: 'org.gnome.Shell',
  path: '/solutions/estuary/LogTime/Window',
  method: 'solutions.estuary.LogTime.Window.GetFocused',
}

const userExtensionDir = () => path.join(os.homedir(), '.local', 'share', 'gnome-shell', 'extensions', GNOME_EXTENSION_UUID)

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)))
  })

export const isGnomeExtensionInstalled = () =>
  fs.existsSync(path.join(userExtensionDir(), 'metadata.json')) ||
  fs.existsSync(path.join('/usr/share/gnome-shell/extensions', GNOME_EXTENSION_UUID, 'metadata.json'))

/** Gọi extension qua D-Bus; trả về chuỗi JSON cửa sổ đang focus, lỗi nếu extension chưa chạy */
export const queryFocusedWindow = () =>
  run('gdbus', [
    'call', '--session',
    '--dest', GNOME_EXTENSION_DBUS.dest,
    '--object-path', GNOME_EXTENSION_DBUS.path,
    '--method', GNOME_EXTENSION_DBUS.method,
  ])

export async function installGnomeExtension(sourceRoot: string) {
  const source = path.join(sourceRoot, GNOME_EXTENSION_UUID)
  if (!fs.existsSync(path.join(source, 'metadata.json'))) {
    throw new Error(`Không tìm thấy extension trong ${source}`)
  }

  const target = userExtensionDir()
  fs.mkdirSync(target, { recursive: true })
  for (const file of fs.readdirSync(source)) {
    fs.copyFileSync(path.join(source, file), path.join(target, file))
  }

  // GNOME Shell chỉ phát hiện extension mới sau khi đăng nhập lại (Wayland), nên ngoài lệnh enable
  // còn thêm UUID vào danh sách enabled-extensions để extension tự bật ở phiên sau.
  try {
    await run('gnome-extensions', ['enable', GNOME_EXTENSION_UUID])
  } catch {
    try {
      const current = (await run('gsettings', ['get', 'org.gnome.shell', 'enabled-extensions'])).trim()
      const list: string[] = current.startsWith('@as') ? [] : JSON.parse(current.replace(/'/g, '"'))
      if (!list.includes(GNOME_EXTENSION_UUID)) {
        list.push(GNOME_EXTENSION_UUID)
        await run('gsettings', ['set', 'org.gnome.shell', 'enabled-extensions', JSON.stringify(list).replace(/"/g, "'")])
      }
    } catch {
      /* gsettings không có: người dùng tự bật trong app Extensions */
    }
  }

  let userExtensionsDisabled = false
  try {
    userExtensionsDisabled = (await run('gsettings', ['get', 'org.gnome.shell', 'disable-user-extensions'])).trim() === 'true'
  } catch {
    /* bỏ qua */
  }

  // Chỉ coi là đã hoạt động khi gọi được method D-Bus của extension
  const active = await queryFocusedWindow().then(() => true, () => false)
  return { installedTo: target, active, needsRelogin: !active, userExtensionsDisabled }
}
