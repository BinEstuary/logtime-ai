// Cross-compile redmine CLI (Go) cho các nền tảng desktop, đặt vào build/bin/<platform>-<arch>/.
// Dùng `go` nếu có sẵn trên máy, nếu không thì build trong Docker (golang image).
//
//   node scripts/build-redmine.mjs                 # mọi nền tảng
//   node scripts/build-redmine.mjs linux-x64 win32-x64
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'redmine-cli-src')
const outRoot = path.join(root, 'build', 'bin')
const GO_IMAGE = 'golang:1.25-alpine'
// Cache module/build của Go giữa các lần build Docker (chạy bằng user hiện tại nên không dùng /go của image)
const goCacheDir = path.join(root, 'build', '.go-cache')

// Tên theo quy ước Electron (process.platform-process.arch) → GOOS/GOARCH
const TARGETS = {
  'linux-x64': ['linux', 'amd64'],
  'linux-arm64': ['linux', 'arm64'],
  'win32-x64': ['windows', 'amd64'],
  'darwin-x64': ['darwin', 'amd64'],
  'darwin-arm64': ['darwin', 'arm64'],
}

const requested = process.argv.slice(2)
const targets = requested.length ? requested : Object.keys(TARGETS)
for (const t of targets) {
  if (!TARGETS[t]) {
    console.error(`Target không hợp lệ: ${t}. Hỗ trợ: ${Object.keys(TARGETS).join(', ')}`)
    process.exit(1)
  }
}

fs.mkdirSync(goCacheDir, { recursive: true })
const hasGo = spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0
const ldflags = '-s -w -X main.version=logtime-desktop'

for (const target of targets) {
  const [goos, goarch] = TARGETS[target]
  const binName = goos === 'windows' ? 'redmine.exe' : 'redmine'
  const outDir = path.join(outRoot, target)
  fs.mkdirSync(outDir, { recursive: true })
  console.log(`→ redmine ${target} (${goos}/${goarch})${hasGo ? '' : ' [docker]'}`)

  if (hasGo) {
    execFileSync('go', ['build', '-trimpath', '-ldflags', ldflags, '-o', path.join(outDir, binName), './cmd/redmine'], {
      cwd: srcDir,
      stdio: 'inherit',
      env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
    })
  } else {
    execFileSync(
      'docker',
      [
        'run', '--rm',
        '-v', `${srcDir}:/src:ro`,
        '-v', `${outDir}:/out`,
        '-v', `${goCacheDir}:/gocache`,
        '-w', '/src',
        '-e', `GOOS=${goos}`, '-e', `GOARCH=${goarch}`, '-e', 'CGO_ENABLED=0',
        '-e', 'GOFLAGS=-buildvcs=false -modcacherw',
        '--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
        '-e', 'GOMODCACHE=/gocache/mod', '-e', 'GOCACHE=/gocache/build', '-e', 'HOME=/tmp',
        GO_IMAGE,
        'go', 'build', '-trimpath', '-ldflags', ldflags, '-o', `/out/${binName}`, './cmd/redmine',
      ],
      { stdio: 'inherit' }
    )
  }
}
console.log(`Xong: ${outRoot}`)
