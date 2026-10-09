// Tạo download-page/release.js từ các bản build trong release/ để xem trước trang tải trên máy.
// Trên GitHub Pages, workflow pages.yml ghi đè file này bằng dữ liệu GitHub Release thật.
//
//   node scripts/make-download-data.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const outFile = path.join(root, 'download-page', 'release.js')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const installers = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((name) => /\.(exe|dmg|AppImage|deb)$/.test(name))
  : []

const data = installers.length
  ? {
      version: `v${pkg.version} (bản build trên máy)`,
      publishedAt: new Date(Math.max(...installers.map((n) => fs.statSync(path.join(releaseDir, n)).mtimeMs))).toISOString(),
      assets: installers.map((name) => ({
        name,
        size: fs.statSync(path.join(releaseDir, name)).size,
        // Đường dẫn tương đối từ download-page/ tới release/
        url: `../release/${encodeURIComponent(name)}`,
      })),
    }
  : {}

fs.writeFileSync(outFile, `window.RELEASE_DATA = ${JSON.stringify(data, null, 2)};\n`)
console.log(`${outFile}: ${installers.length ? installers.join(', ') : 'chưa có bản build nào trong release/'}`)
