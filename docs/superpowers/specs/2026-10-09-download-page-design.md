# Trang download LogTime AI (GitHub Releases + GitHub Pages)

## Context
App desktop (Electron, `package.json` → electron-builder) đã build được bộ cài cho Windows/Linux/macOS
(`release/LogTime-AI-<ver>-<os>-<arch>.<ext>`), nhưng chưa có chỗ để đồng nghiệp tự tải về.
Workflow `.github/workflows/desktop.yml` hiện chỉ upload *Actions artifacts* (hết hạn, cần login), chưa tạo Release.
Mục tiêu: một trang web riêng, nội bộ, có nút tải bộ cài phiên bản mới nhất cho từng OS.

Quyết định đã chốt với user:
- File cài đặt lưu trên **GitHub Releases**, repo **public**.
- Trang download host trên **GitHub Pages**, tách khỏi web app Vite/K3s.
- Đối tượng: **nội bộ công ty** → trang gọn, tiếng Việt, không SEO/marketing.

## Thiết kế

### 1. Trang tĩnh `download-page/`
- `download-page/index.html`: HTML + CSS + JS inline, không build step, không framework.
  - Header: logo (copy `public/logo.png` → `download-page/logo.png`), "LogTime AI", mô tả ngắn, version + ngày phát hành.
  - **Nút chính**: tự nhận diện OS qua `navigator.userAgentData?.platform` / `navigator.userAgent`
    → nút lớn "Tải cho Windows/macOS/Linux". macOS: mặc định Apple Silicon, kèm link Intel.
  - **Lưới tất cả bản**: Windows (.exe), macOS Apple Silicon (.dmg arm64), macOS Intel (.dmg x64),
    Linux AppImage, Linux .deb — mỗi thẻ có tên file + dung lượng (MB).
  - **Hướng dẫn cài** (`<details>` theo OS), vì app chưa ký số:
    - Windows: SmartScreen → "More info" → "Run anyway".
    - macOS: chuột phải → Open, hoặc `xattr -cr "/Applications/LogTime AI.app"`.
    - Linux: `chmod +x LogTime-AI-*.AppImage` / `sudo apt install ./LogTime-AI-*.deb`.
  - Link "Tất cả phiên bản" → `https://github.com/<repo>/releases`.
  - Light/dark theo `prefers-color-scheme`, responsive.
- Dữ liệu: JS `fetch('release.json')`. Map asset → nền tảng bằng regex trên tên file
  (`/win-x64\.exe$/`, `/mac-arm64\.dmg$/`, `/mac-x64\.dmg$/`, `/\.AppImage$/`, `/\.deb$/`);
  bỏ qua `.blockmap`, `latest*.yml`.
- Fallback: không tải được `release.json` hoặc thiếu asset cho một OS → nút đó chuyển thành
  link tới trang Releases + dòng chú thích "Chưa có bản cho …".

### 2. `release.json` sinh lúc deploy (không gọi GitHub API từ trình duyệt)
Lý do: API không cần token bị giới hạn 60 lượt/giờ/IP; cả công ty dùng chung NAT sẽ nhanh chạm giới hạn.
Bước CI:
```sh
gh api repos/$GITHUB_REPOSITORY/releases/latest \
  | jq '{version: .tag_name, publishedAt: .published_at, htmlUrl: .html_url,
         assets: [.assets[] | {name, size, url: .browser_download_url}]}' \
  > download-page/release.json
```
(Chưa có release nào → ghi `{}`, trang hiện fallback.) Tên repo lấy từ `$GITHUB_REPOSITORY`, không hardcode.

### 3. CI
- **Workflow mới `.github/workflows/pages.yml`**
  - Triggers: `push` lên `main` với `paths: download-page/**`, `workflow_dispatch`, `workflow_call`.
  - `permissions: pages: write, id-token: write, contents: read`.
  - Các bước: checkout → sinh `release.json` (ở trên) → `actions/configure-pages@v5`
    → `actions/upload-pages-artifact@v3` (path `download-page`) → `actions/deploy-pages@v4`.
- **Sửa `.github/workflows/desktop.yml`**
  - Giữ job `build` matrix như cũ.
  - Thêm job `release` (`needs: build`, `if: startsWith(github.ref, 'refs/tags/v')`,
    `permissions: contents: write`): `actions/download-artifact@v4` (merge-multiple) →
    `gh release create "$GITHUB_REF_NAME" --generate-notes <files>` (chỉ `.exe .dmg .AppImage .deb`).
  - Thêm job `pages` (`needs: release`): `uses: ./.github/workflows/pages.yml`
    (gọi trực tiếp vì release tạo bằng `GITHUB_TOKEN` sẽ không kích hoạt workflow khác).

### Việc user cần làm một lần (ngoài code)
1. Tạo repo **public** trên GitHub, `git remote add origin …`, push `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Phát hành: tăng `version` trong `package.json`, `git tag v1.0.1 && git push --tags`.
4. (Không bắt buộc) chia sẻ link `https://<owner>.github.io/<repo>/`.

## Files
- Mới: `download-page/index.html`, `download-page/logo.png`, `download-page/favicon.png`, `download-page/release.json` (mẫu cho dev, CI ghi đè),
  `.github/workflows/pages.yml`
- Sửa: `.github/workflows/desktop.yml`
- Khi bắt đầu implement: lưu spec vào `docs/superpowers/specs/2026-10-09-download-page-design.md`.

## Kiểm tra
1. Local: `python3 -m http.server -d download-page 8080`, mở http://localhost:8080:
   - `release.json` mẫu có đủ 5 asset → đủ 5 thẻ, đúng dung lượng, nút chính khớp OS hiện tại.
   - Đổi UA (DevTools device mode / override) → nút chính đổi theo Windows/macOS.
   - Xoá asset mac khỏi JSON → thẻ mac hiện fallback; đổi thành `{}` / xoá file → toàn trang fallback, không lỗi JS.
   - Kiểm tra mobile width + dark mode.
2. Workflow: `actionlint` (nếu có) cho 2 file YAML.
3. Sau khi có remote: chạy `pages.yml` bằng workflow_dispatch → trang lên Pages; push tag thử `v1.0.0`
   → Release có đủ file, trang tự cập nhật version và link tải chạy được.
